import { isRussianPostalIndex } from './postal-index';

/*
 * Детектор российских почтовых адресов.
 *
 * Адрес ищется в два шага:
 *  1. Отдельные компоненты: индекс, регион, район, населённый пункт, улица,
 *     микрорайон/квартал, дом, квартира. Каждый компонент — своя регулярка с
 *     ключевым словом из словаря сокращений.
 *  2. Компоненты, стоящие рядом (через запятую, пробел или перенос строки),
 *     склеиваются в одну цепочку. Цепочка становится находкой целиком, если в
 *     ней есть номер дома и хотя бы улица, микрорайон или населённый пункт.
 *
 * Поэтому «г. Москва, ул. Тверская, д. 1» маскируется одним блоком, а «г.
 * Кострома» или «ул. Ленина» без номера дома не маскируются вовсе.
 *
 * Сокращения взяты из Правил сокращённого наименования адресообразующих
 * элементов (приказ Минфина России от 05.11.2015 № 171н) и дополнены
 * распространёнными бытовыми вариантами («просп.», «корп.», «пос.»).
 *
 * Границы слов заданы через \p{L}/\p{N}: в JS \b не считает кириллицу буквами.
 */

type ComponentKind =
  | 'index'
  | 'region'
  | 'district'
  | 'settlement'
  | 'street'
  | 'planning'
  | 'house'
  | 'room';

interface Component {
  readonly kind: ComponentKind;
  readonly start: number;
  readonly end: number;
  /** Улица или микрорайон, к которым сразу приписан номер дома. */
  readonly withHouse: boolean;
}

/*
 * Границы рассчитаны и на склеенный текст (вставка без переносов строк):
 *  - слева компонент не может продолжать слово, но может стоять вплотную к
 *    цифре («…д. 26г. Москва…») или начинаться с заглавной сразу после
 *    строчной («…вход со двораРоссия, 101000…» — так выглядит стык строк);
 *  - справа запрещены строчная буква и цифра, заглавная допускается
 *    («…ул. Тверская, д. 7Заказ № …»).
 */
const LEFT = String.raw`(?:(?<!\p{L})|(?<=\p{Ll})(?=\p{Lu}))`;
const RIGHT = String.raw`(?![\p{Ll}\p{N}])`;
/**
 * После номера дома не должно идти продолжение числа (телефон, диапазон).
 * Буквы допускаются: буквенный суффикс («12а») уже съеден номером, а
 * прилипшее слово следующей строки («д. 7Заказ») не должно ломать адрес.
 */
const RIGHT_NUM = String.raw`(?!\p{N}|[ \t]*[-(]?[ \t]*\d)`;

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ключевые слова: длинные варианты раньше коротких, первая буква в любом
 * регистре («Ул.» в начале предложения).
 */
function keywords(words: readonly string[]): string {
  return [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => {
      const first = w[0]!;
      const head =
        first.toLowerCase() !== first.toUpperCase()
          ? `[${first.toLowerCase()}${first.toUpperCase()}]`
          : escapeRe(first);
      return head + escapeRe(w.slice(1));
    })
    .join('|');
}

/**
 * Дешёвая проверка первого символа перед дорогой проверкой границы слова.
 * Регулярка компонента пробуется в каждой позиции текста; без этой проверки
 * просмотр назад (LEFT) выполнялся везде, и адресный детектор стал самым
 * медленным в движке. Компонент с ключевым словом может начаться только с
 * первой буквы одного из своих слов.
 */
function startsWithKeyword(words: readonly string[]): string {
  const firsts = new Set<string>();
  for (const w of words) {
    firsts.add(w[0]!.toLowerCase());
    firsts.add(w[0]!.toUpperCase());
  }
  return `(?=[${[...firsts].map(escapeRe).join('')}])`;
}
/** Компонент, начинающийся с названия: заглавная буква. */
const STARTS_WITH_CAPITAL = String.raw`(?=\p{Lu})`;
/** Название улицы может начинаться ещё с цифры («8 Марта») и с «им.», «реки», «канала». */
const STARTS_WITH_STREET_NAME = String.raw`(?=[\p{Lu}\dиркИРК])`;

/**
 * Разделитель после ключевого слова-префикса: точка (и пробелы) или пробел.
 * Однобуквенные сокращения («п», «с», «д», «х») без точки не принимаются:
 * «с Иваном» — это предлог, а не село.
 */
function afterKeyword(words: readonly string[], dotOptional: boolean): string {
  const kw = keywords(words);
  return dotOptional
    ? String.raw`(?:${kw})(?:\.[ \t]*|[ \t]+)`
    : String.raw`(?:${kw})\.[ \t]*`;
}

// ---------------------------------------------------------------- Словарь ---

const STREET_WORDS = [
  'улица', 'ул',
  'проспект', 'просп', 'пр-кт', 'пр-т',
  'переулок', 'пер',
  'бульвар', 'б-р',
  'шоссе',
  'проезд', 'пр-д',
  'набережная', 'наб',
  'площадь', 'пл',
  'тупик', 'туп',
  'аллея', 'линия', 'тракт', 'дорога', 'спуск', 'сквер',
];
/** Требуют точки: «ш.», «пр.» (проспект/проезд в бытовой записи). */
const STREET_WORDS_DOT = ['ш', 'пр'];

const PLANNING_WORDS = [
  'микрорайон', 'мкр-н', 'мкрн', 'мкр',
  'квартал', 'кв-л',
  'территория', 'тер',
  'снт', 'СНТ', 'днт', 'ДНТ', 'тсн', 'ТСН',
  'жилой комплекс', 'жк', 'ЖК',
];

const SETTLEMENT_WORDS = [
  'город',
  'посёлок городского типа', 'поселок городского типа', 'пгт',
  'рабочий посёлок', 'рабочий поселок', 'рп',
  'посёлок', 'поселок', 'пос',
  'село', 'деревня', 'станица', 'ст-ца', 'хутор', 'аул', 'слобода', 'нп',
];
/** «г Москва» без точки встречается в выгрузках ФИАС, поэтому «г» — без точки. */
const SETTLEMENT_WORDS_NO_DOT_OK = ['г'];
const SETTLEMENT_WORDS_DOT = ['п', 'с', 'д', 'х', 'р.п'];

const REGION_POSTFIX = [
  'область', 'обл',
  'край',
  'автономный округ', 'автономная область', 'а.окр', 'а.обл', 'АО',
  'республика', 'респ',
];
const REGION_PREFIX = ['республика', 'респ'];

const DISTRICT_WORDS = [
  'муниципальный район', 'м.р-н',
  'муниципальный округ', 'м.о',
  'городской округ', 'г.о',
  'внутригородской район', 'вн.р-н',
  'район', 'р-н',
];

const HOUSE_WORDS = [
  'домовладение', 'владение', 'влд', 'вл',
  'участок', 'уч',
  'здание', 'зд',
  'дом', 'д',
  'корпус', 'корп',
];

const ROOM_WORDS = [
  'квартира', 'кв',
  'офис', 'оф',
  'помещение', 'помещ', 'пом',
  'комната', 'комн', 'ком',
  'подъезд', 'этаж',
];
/**
 * Требуют точки: «под 3 метрами» — предлог, а «под. 3» — подъезд.
 * Без подъезда и этажа в словаре цепочка обрывалась на них, и квартира
 * после них («…д. 5, под. 3, эт. 4, кв. 56») оставалась без маски.
 */
const ROOM_WORDS_DOT = ['под', 'эт'];

/** Знак номера перед номером дома или квартиры: «дом №5», «кв. № 7». */
const NUM_SIGN = String.raw`(?:№[ \t]*)?`;

/** Без ключевого слова признаём только страну и города федерального значения. */
const BARE_PLACES = ['Российская Федерация', 'Россия', 'РФ', 'Москва', 'Санкт-Петербург', 'Севастополь'];

// ------------------------------------------------------------ Части имён ---

/** Слово с заглавной буквы: «Тверская», «Ростов-на-Дону», «СНТ», «Восточный-2». */
const CAP_WORD = String.raw`\p{Lu}\p{L}+(?:-(?:\p{L}+|\d{1,3}))*`;
/** Инициал: «М.» в «ул. М. Горького». */
const INITIAL = String.raw`\p{Lu}\.[ \t]*`;
/** Порядковое число: «1-я», «3-й», «8». */
const ORDINAL = String.raw`\d{1,3}(?:-?(?:ая|ое|ый|ий|ой|го|я|й|е))?`;

/** Строчные слова, с которых может начинаться название: «наб. реки Мойки». */
const NAME_LEAD = String.raw`(?:(?:им\.|имени|реки|канала|протоки)[ \t]*)`;
/** Название улицы: «Тверская», «8 Марта», «50 лет Октября», «им. Ленина». */
const STREET_NAME = String.raw`${NAME_LEAD}?(?:${ORDINAL}[ \t]+(?:лет[ \t]+)?)?(?:${INITIAL})?${CAP_WORD}(?:[ \t]+(?:${INITIAL})?${CAP_WORD}){0,3}`;
/** Название населённого пункта, региона: «Москва», «Нижний Новгород». */
const PLACE_NAME = String.raw`${CAP_WORD}(?:[ \t]+${CAP_WORD}){0,2}`;

/** Номер дома: «5», «12а», «32А», «5к2», «10/2». */
const HOUSE_NUMBER = String.raw`\d{1,4}(?:[кК]\d{1,3}|[а-яёА-ЯЁ](?![\p{L}\d.]))?(?:[ \t]*\/[ \t]*\d{1,4}[а-яёА-ЯЁ]?)?`;
/** Корпус, строение, литера после номера дома. */
const HOUSE_EXTRA = String.raw`(?:[ \t]*,?[ \t]*(?:корпус|корп|к)\.?[ \t]*\d{1,3}[а-яё]?)?(?:[ \t]*,?[ \t]*(?:строение|стр)\.?[ \t]*\d{1,3}[а-яё]?)?(?:[ \t]*,?[ \t]*(?:литера|литер|лит)\.?[ \t]*\p{Lu})?`;
const HOUSE_BODY = String.raw`${HOUSE_NUMBER}${HOUSE_EXTRA}${RIGHT_NUM}`;
/** Номер дома сразу после улицы: «ул. Ленина, 5», «ул. Ленина, д. 5». */
const HOUSE_TAIL = String.raw`(?<house>[ \t]*,?[ \t]*(?:${afterKeyword(HOUSE_WORDS, true)}|(?:${keywords(HOUSE_WORDS)})(?=\d))?${NUM_SIGN}${HOUSE_BODY})?`;

// ------------------------------------------------------------ Компоненты ---

const DOT_OR_END = String.raw`(?:\.|${RIGHT})`;

const COMPONENTS: readonly { kind: ComponentKind; source: string }[] = [
  // 101000 — проверяется по словарю; «101000, Москва,» — индекс с городом без «г.».
  {
    kind: 'index',
    source: String.raw`(?<!\p{N})\d{6}(?!\p{N})(?:[ \t]*,[ \t]*${PLACE_NAME}(?=[ \t]*,))?`,
  },
  { kind: 'region', source: String.raw`${startsWithKeyword(REGION_PREFIX)}${LEFT}${afterKeyword(REGION_PREFIX, true)}${PLACE_NAME}` },
  {
    kind: 'region',
    source: String.raw`${STARTS_WITH_CAPITAL}${LEFT}${PLACE_NAME}[ \t]+(?:${keywords(REGION_POSTFIX)})${DOT_OR_END}`,
  },
  { kind: 'district', source: String.raw`${startsWithKeyword(DISTRICT_WORDS)}${LEFT}${afterKeyword(DISTRICT_WORDS, true)}${PLACE_NAME}` },
  {
    kind: 'district',
    source: String.raw`${STARTS_WITH_CAPITAL}${LEFT}${PLACE_NAME}[ \t]+(?:${keywords(DISTRICT_WORDS)})${DOT_OR_END}`,
  },
  {
    kind: 'settlement',
    source: String.raw`${startsWithKeyword([...SETTLEMENT_WORDS, ...SETTLEMENT_WORDS_NO_DOT_OK, ...SETTLEMENT_WORDS_DOT])}${LEFT}(?:${afterKeyword(SETTLEMENT_WORDS, true)}|${afterKeyword(SETTLEMENT_WORDS_NO_DOT_OK, true)}|${afterKeyword(SETTLEMENT_WORDS_DOT, false)})${PLACE_NAME}`,
  },
  { kind: 'settlement', source: String.raw`${STARTS_WITH_CAPITAL}${LEFT}${PLACE_NAME}[ \t]+г${DOT_OR_END}` },
  { kind: 'settlement', source: String.raw`${STARTS_WITH_CAPITAL}${LEFT}(?:${BARE_PLACES.map(escapeRe).join('|')})${RIGHT}` },
  {
    kind: 'street',
    source: String.raw`${startsWithKeyword([...STREET_WORDS, ...STREET_WORDS_DOT])}${LEFT}(?:${afterKeyword(STREET_WORDS, true)}|${afterKeyword(STREET_WORDS_DOT, false)})${STREET_NAME}${HOUSE_TAIL}`,
  },
  {
    kind: 'street',
    source: String.raw`${STARTS_WITH_STREET_NAME}${LEFT}${STREET_NAME}[ \t]+(?:${keywords([...STREET_WORDS, ...STREET_WORDS_DOT])})${DOT_OR_END}${HOUSE_TAIL}`,
  },
  // «мкр. Северный», «мкр 5», «тер. СНТ Ромашка».
  {
    kind: 'planning',
    source: String.raw`${startsWithKeyword(PLANNING_WORDS)}${LEFT}${afterKeyword(PLANNING_WORDS, true)}(?:${STREET_NAME}|\d{1,3}(?:[а-яё](?![\p{L}\d.]))?${RIGHT})${HOUSE_TAIL}`,
  },
  // «3-й мкр.», «5 мкр», «Северный микрорайон».
  {
    kind: 'planning',
    source: String.raw`${STARTS_WITH_STREET_NAME}${LEFT}(?:${ORDINAL}|${STREET_NAME})[ \t]+(?:${keywords(['микрорайон', 'мкр-н', 'мкрн', 'мкр', 'квартал', 'кв-л'])})${DOT_OR_END}${HOUSE_TAIL}`,
  },
  {
    kind: 'house',
    source: String.raw`${startsWithKeyword(HOUSE_WORDS)}${LEFT}(?:${afterKeyword(HOUSE_WORDS, true)}${NUM_SIGN}|(?:${keywords(HOUSE_WORDS)})(?=\d))${HOUSE_BODY}`,
  },
  {
    kind: 'room',
    source: String.raw`${startsWithKeyword([...ROOM_WORDS, ...ROOM_WORDS_DOT])}${LEFT}(?:${afterKeyword(ROOM_WORDS, true)}${NUM_SIGN}|${afterKeyword(ROOM_WORDS_DOT, false)}|(?:${keywords(ROOM_WORDS)})(?=\d))\d{1,5}(?:[а-яё](?![\p{L}\d.]))?${RIGHT_NUM}`,
  },
  // «2 этаж», «3 эт.» — номер перед словом.
  { kind: 'room', source: String.raw`(?=\d)${LEFT}\d{1,3}[ \t]*(?:этаж|эт\.)${RIGHT}` },
];

/** Сколько компонентов максимум может быть в одном адресе. */
const MAX_CHAIN = 12;

/** Разделитель между компонентами: запятая/точка с запятой, пробелы, один перенос. */
function skipSeparator(text: string, from: number): number {
  let i = from;
  let punct = false;
  let newline = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\u00a0') i += 1;
    else if ((ch === ',' || ch === ';') && !punct) {
      punct = true;
      i += 1;
    } else if (ch === '\n' && !newline) {
      newline = true;
      i += 1;
    } else if (ch === '\r') i += 1;
    else break;
  }
  return i;
}

/**
 * Регулярки компонентов компилируются один раз при загрузке модуля: они
 * большие и с Unicode-классами, и компиляция на каждый скан стоила больше,
 * чем сам поиск. matchAll внутри себя копирует регулярку, поэтому общий
 * объект безопасен (lastIndex не разделяется между вызовами).
 */
const COMPILED = COMPONENTS.map(({ kind, source }) => ({ kind, re: new RegExp(source, 'gu') }));

function collectComponents(text: string): Component[] {
  const found: Component[] = [];
  for (const { kind, re } of COMPILED) {
    for (const m of text.matchAll(re)) {
      const start = m.index!;
      if (kind === 'index' && !isRussianPostalIndex(text.slice(start, start + 6))) continue;
      found.push({
        kind,
        start,
        end: start + m[0].length,
        withHouse: m.groups?.house !== undefined,
      });
    }
  }
  return found;
}

/** Адрес признаётся, если есть дом и есть улица, микрорайон или населённый пункт. */
function isAddress(chain: readonly Component[]): boolean {
  const hasHouse = chain.some((c) => c.kind === 'house' || c.withHouse);
  const hasPlace = chain.some(
    (c) => c.kind === 'street' || c.kind === 'planning' || c.kind === 'settlement',
  );
  return hasHouse && hasPlace;
}

/**
 * Найти адреса в тексте. Возвращает непересекающиеся блоки в порядке чтения.
 *
 * Склейка — динамическое программирование справа налево: для каждого
 * компонента запоминается самая длинная цепочка, которая с него начинается
 * (следующий компонент должен начинаться ровно там, где кончился разделитель).
 */
export function findRussianAddresses(text: string): { index: number; value: string }[] {
  // Без цифр нет номера дома, а значит и адреса: не запускаем 14 регулярок зря.
  if (!/\d/.test(text)) return [];
  const components = collectComponents(text);
  if (components.length === 0) return [];

  const byStart = new Map<number, Component[]>();
  for (const c of components) {
    const list = byStart.get(c.start);
    if (list) list.push(c);
    else byStart.set(c.start, [c]);
  }

  // best: компонент → [конец цепочки, длина цепочки, следующий компонент].
  const best = new Map<Component, { end: number; length: number; next: Component | null }>();
  const ordered = [...components].sort((a, b) => b.start - a.start);
  for (const c of ordered) {
    let pick: { end: number; length: number; next: Component | null } = {
      end: c.end,
      length: 1,
      next: null,
    };
    for (const n of byStart.get(skipSeparator(text, c.end)) ?? []) {
      const tail = best.get(n)!;
      if (tail.length >= MAX_CHAIN) continue;
      if (tail.end > pick.end || (tail.end === pick.end && tail.length + 1 > pick.length)) {
        pick = { end: tail.end, length: tail.length + 1, next: n };
      }
    }
    best.set(c, pick);
  }

  const results: { index: number; value: string }[] = [];
  const starts = [...components].sort((a, b) => a.start - b.start || b.end - a.end);
  let consumedUntil = -1;
  for (const first of starts) {
    if (first.start < consumedUntil) continue;
    const chain: Component[] = [];
    for (let c: Component | null = first; c; c = best.get(c)!.next) chain.push(c);
    const last = chain[chain.length - 1]!;
    if (!isAddress(chain)) continue;
    results.push({ index: first.start, value: text.slice(first.start, last.end) });
    consumedUntil = last.end;
  }
  return results;
}
