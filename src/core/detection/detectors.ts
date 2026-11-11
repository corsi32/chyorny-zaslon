// Изменено в проекте «Чёрный заслон», 2026: телефоны РФ, разбор склеенных цепочек телефонов и карт, новые детекторы РФ, проверка префикса карты, IPv4 со склейкой. Подробнее — в NOTICE.
import { findRussianAddresses } from './ru-address';
import {
  cardScheme,
  findBankAccounts,
  passportPattern,
  passportValid,
  snilsPattern,
  snilsValid,
} from './ru-documents';
import type { FindingType } from './types';

/** A candidate produced by a detector: matched substring and its offset. */
export interface DetectorMatch {
  readonly index: number;
  readonly value: string;
}

interface DetectorBase {
  readonly id: string;
  readonly type: FindingType;
  validate?(value: string): boolean;
  /**
   * Значение не может быть серединой латинского идентификатора: кандидат,
   * у которого И слева, И справа вплотную латинская буква или «_», движок
   * отбрасывает («sha a3f89991234567bc…», «id=AbC4242424242424242xyz»).
   * Нужен цифровым детекторам с ослабленными границами: им разрешены
   * соседние буквы ради склеенного текста, а при склейке слово прилипает
   * только с одной стороны.
   */
  readonly notInsideIdentifier?: boolean;
}

/**
 * A regex-based detector. `pattern()` returns a *fresh* global regex on every
 * call so that mutable `lastIndex` state is never shared between scans.
 * `validate` optionally rejects false positives (e.g. Luhn check).
 */
export interface RegexDetector extends DetectorBase {
  pattern(): RegExp;
  readonly find?: never;
}

/**
 * Детектор, которому одной регулярки мало: сам обходит текст и возвращает
 * кандидатов. Нужен, когда решение зависит от соседних фрагментов — адрес
 * собирается из нескольких частей, счёт принимается по слову «р/с» рядом.
 */
export interface FinderDetector extends DetectorBase {
  find(text: string): Iterable<DetectorMatch>;
  readonly pattern?: never;
}

export type Detector = RegexDetector | FinderDetector;

/** Shannon entropy in bits per character. */
function shannonEntropy(value: string): number {
  const freq = new Map<string, number>();
  for (const ch of value) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Generic-secret heuristic. Requiring all three character classes rejects
 * prose, camelCase identifiers and hex digests; the entropy floor rejects
 * repetitive strings. All-lowercase secrets (e.g. hex API keys) are
 * deliberately missed — flagging every long word would drown users in false
 * positives, and review lets them uncheck the rare miss anyway.
 */
function highEntropyValid(value: string): boolean {
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) return false;
  return shannonEntropy(value) >= 4.0;
}

/** ISO 13616 mod-97 check; rejects nearly every random letter/digit run. */
function ibanValid(value: string): boolean {
  const iban = value.replace(/ /g, '');
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const part = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of part) remainder = (remainder * 10 + digit.charCodeAt(0) - 48) % 97;
  }
  return remainder === 1;
}

/** Luhn checksum, used to cut down credit-card false positives. */
function luhnValid(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/*
 * Телефонные номера.
 *
 * Шаблон намеренно строгий. Движок ограничивает число совпадений одного
 * детектора, поэтому «любые цифры через пробел» нужно отсекать ещё
 * регуляркой, а не только в phoneValid: иначе на длинном тексте (логи,
 * таблицы) мусорные кандидаты вытесняют настоящие номера.
 *
 * Поддерживаемые формы:
 *  0. +7 — российский номер: ровно 11 цифр (+7 (999) 123-45-67).
 *  1. Остальные с «+» (международные): 7–15 цифр (+375 29 123-45-67, +44 20 7946 0958).
 *  2. Российская с 8 или 7 без «+»: 89991234567, 8-800-555-35-35,
 *     8 (495) 777-88-99, 8 (3452) 12-34-56.
 *  3. Код города без 8: (495) 123-45-67, 999 123-45-67 — только вид «3 + 3-2-2».
 *  4. Семизначный городской 123-45-67 — только после «тел.», «т.», «звоните» и
 *     т. п.: без контекста он неотличим от артикула.
 * К любой форме может идти добавочный: «доб. 123», «ext. 45».
 *
 * Границы. Запрещены только соседние цифры (и «+» слева), а буквы — нет:
 * при вставке текста без переносов строк (так делает, например, Gemini) к
 * номеру прилипают слова соседних строк — «бесплатные:88005553535Форматированные»,
 * и номер с запретом на соседние буквы уходил открытым. Перед «+» цифра
 * допустима: «доб. 102+74951234567».
 * \b не используется: в JS он не считает кириллицу буквами.
 */
const PHONE_DIGIT_LEFT = String.raw`(?<![\p{N}+])`;
const PHONE_RIGHT = String.raw`(?!\p{N})`;
const PHONE_EXT = String.raw`(?:[ \t,]+(?:доб|ext)\.?[ \t]*\d{1,5}(?!\p{N}))?`;
const PHONE_PLUS_FORMS = [
  // 0. +7 и ровно 10 цифр после семёрки.
  String.raw`\+7(?:[ ().-]{0,2}\d){10}`,
  // 1. «+», затем 7–15 цифр; между цифрами не больше двух разделителей («) »).
  String.raw`\+\d(?:[ ().-]{0,2}\d){6,14}`,
];
/** 2. 8/7, код 3–5 цифр (возможно в скобках), остаток 1–3 + 2 + 2; разделители — пробел, дефис, точка. Ровно 11 цифр проверяет phoneValid. */
const PHONE_RU = String.raw`[78][ .-]?\(?\d{3,5}\)?[ .-]?\d{1,3}[ .-]?\d{2}[ .-]?\d{2}`;
/** 3. Код без 8: дефисы 3-2-2 обязательны, иначе это «123 456 789» и т. п. */
const PHONE_CITY = String.raw`\(?\d{3}\)?[ -]?\d{3}-\d{2}-\d{2}`;
/** 4. 123-45-67 только после слова-подсказки. */
const PHONE_LOCAL = String.raw`(?<=(?<!\p{L})(?:тел(?:ефон)?|т|моб|сот|звоните|phone|tel)\.?:?[ \t]{0,3})\d{3}-\d{2}-\d{2}`;

/** Компилируется один раз; matchAll копирует регулярку, так что lastIndex не разделяется. */
const PHONE_PATTERN = new RegExp(
  String.raw`(?:(?<!\+)(?:${PHONE_PLUS_FORMS.join('|')})|${PHONE_DIGIT_LEFT}(?:${PHONE_RU}|${PHONE_CITY}|${PHONE_LOCAL}))${PHONE_RIGHT}${PHONE_EXT}`,
  'giu',
);

/** Окончательная проверка кандидата. */
function phoneValid(value: string): boolean {
  // Добавочный на решение не влияет — проверяем только сам номер.
  const number = value.replace(/[ \t,]*(?:доб|ext).*$/iu, '');
  const digits = number.replace(/\D/g, '');

  // Форма 0: российский номер с +7 — всегда 11 цифр. Иначе к нему прилипло
  // начало следующего номера: «+7 (999) 123-45-678-800-…».
  if (number.startsWith('+7')) return digits.length === 11;
  // Форма 1: длина номера по E.164 — от 7 до 15 цифр.
  if (number.startsWith('+')) return digits.length >= 7 && digits.length <= 15;

  // Форма 2: российский номер — ровно 11 цифр, первая 7 или 8.
  if (/^[78]/.test(number) && digits.length === 11) {
    if (/[\s().-]/.test(number)) return true;
    // Сплошные 11 цифр без разделителей принимаем только для мобильных (9xx)
    // и бесплатных 8-800: иначе это обычно номер документа или код из чека.
    const code = digits.slice(1, 4);
    return code.startsWith('9') || code === '800';
  }

  // Формы 3 и 4: формат уже задан шаблоном, сверяем его целиком.
  return /^(?:\(?\d{3}\)?[ -]?)?\d{3}-\d{2}-\d{2}$/.test(number);
}

/*
 * Слитные цепочки номеров. При вставке списка без переносов строк номера
 * прилипают друг к другу: «8999123456789167778899» (два мобильных),
 * «+7 (999) 123-45-678-800-555-35-358 (495) 777-88-99» (три номера). По
 * отдельности ни один из них не проходит проверку границ — рядом цифры.
 *
 * Поэтому отрезки из цифр и разделителей, в которых не меньше 14 цифр,
 * пробуем разрезать на номера целиком, без остатка. Если получилось два и
 * больше номера — это цепочка. Если хоть одна цифра не ложится в номер
 * (штрихкод «8999123456789», ИНН, длинный ID), цепочка не принимается:
 * так склейка не открывает дорогу ложным срабатываниям.
 */
const PHONE_RUN = /[+\d(][\d +()-]*\d/g;
const PHONE_RU_EXACT = new RegExp(`^(?:${PHONE_RU})$`, 'u');
const PHONE_CITY_EXACT = new RegExp(`^(?:${PHONE_CITY})$`, 'u');
const MAX_RUN_LENGTH = 300;

/** Возможные концы номера, начинающегося в позиции `start` отрезка. */
function phoneEndsAt(run: string, start: number): number[] {
  const ends: number[] = [];
  let digits = 0;
  for (let i = start; i < run.length; i++) {
    const ch = run[i]!;
    if (ch >= '0' && ch <= '9') digits += 1;
    else if (!(ch === '+' && i === start) && !' ()-'.includes(ch)) break;
    if (digits > 15) break;
    if (ch < '0' || ch > '9') continue;
    const candidate = run.slice(start, i + 1);
    const ok = candidate.startsWith('+')
      ? digits >= 7
      : (digits === 11 && PHONE_RU_EXACT.test(candidate)) ||
        (digits === 10 && PHONE_CITY_EXACT.test(candidate));
    if (ok && phoneValid(candidate)) ends.push(i + 1);
  }
  return ends;
}

/**
 * Возможные концы номера карты, начинающегося в позиции `start` отрезка:
 * 13–19 цифр через пробел или дефис, Луна и префикс платёжной системы.
 * Нужно для склейки «…7946 09152200 7001 2345 6781…», где к карте вплотную
 * прилипли цифры соседних строк.
 */
function cardEndsAt(run: string, start: number): number[] {
  const ends: number[] = [];
  if (!(run[start]! >= '0' && run[start]! <= '9')) return ends;
  let digits = 0;
  for (let i = start; i < run.length; i++) {
    const ch = run[i]!;
    if (ch >= '0' && ch <= '9') digits += 1;
    else if (ch === ' ' || ch === '-') {
      // Два разделителя подряд номер карты не разделяют.
      if (run[i - 1] === ' ' || run[i - 1] === '-') break;
      continue;
    } else break;
    if (digits > 19) break;
    if (digits < 13) continue;
    const candidate = run.slice(start, i + 1);
    if (luhnValid(candidate) && cardScheme(candidate) !== null) ends.push(i + 1);
  }
  return ends;
}

type ChainPiece = { start: number; end: number; type: 'phone' | 'credit_card' };

/** Разрезать отрезок на телефоны и карты без остатка; null — если не получается. */
function segmentRun(run: string): ChainPiece[] | null {
  const memo = new Map<number, ChainPiece[] | null>();
  const solve = (from: number): ChainPiece[] | null => {
    let i = from;
    while (i < run.length && (run[i] === ' ' || run[i] === '-')) i += 1;
    if (i >= run.length) return [];
    if (memo.has(i)) return memo.get(i)!;
    let result: ChainPiece[] | null = null;
    // Сначала самые длинные варианты: «+44 20 7946 09152» целиком, а не обрубок.
    const options: ChainPiece[] = [
      ...phoneEndsAt(run, i).map((end) => ({ start: i, end, type: 'phone' as const })),
      ...cardEndsAt(run, i).map((end) => ({ start: i, end, type: 'credit_card' as const })),
    ].sort((a, b) => b.end - a.end);
    for (const piece of options) {
      const rest = solve(piece.end);
      if (rest) {
        result = [piece, ...rest];
        break;
      }
    }
    memo.set(i, result);
    return result;
  };
  return solve(0);
}

interface GluedChains {
  /** Найденные в цепочках телефоны и карты, позиции — в тексте. */
  readonly pieces: readonly ChainPiece[];
  /** Границы разобранных цепочек: внутри них обычный шаблон не применяется. */
  readonly ranges: readonly (readonly [number, number])[];
}

// Детекторы карт и телефонов разбирают один и тот же текст подряд, поэтому
// результат последнего разбора запоминается.
let chainCache: { text: string; result: GluedChains } | null = null;

/** Склеенные цепочки из телефонов и карт (переносы строк пропали при вставке). */
function gluedChains(text: string): GluedChains {
  if (chainCache && chainCache.text === text) return chainCache.result;
  const pieces: ChainPiece[] = [];
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(PHONE_RUN)) {
    const run = m[0];
    if (run.length > MAX_RUN_LENGTH || run.replace(/\D/g, '').length < 14) continue;
    const parts = segmentRun(run);
    if (!parts || parts.length < 2) continue;
    for (const p of parts) pieces.push({ ...p, start: m.index! + p.start, end: m.index! + p.end });
    ranges.push([m.index!, m.index! + run.length]);
  }
  const result = { pieces, ranges };
  chainCache = { text, result };
  return result;
}

function insideChain(chains: GluedChains, start: number, end: number): boolean {
  return chains.ranges.some(([a, b]) => start < b && a < end);
}

/** Поиск телефонов: слитные цепочки + обычный шаблон. */
export function findPhones(text: string): DetectorMatch[] {
  const chains = gluedChains(text);
  const found: DetectorMatch[] = [];
  for (const p of chains.pieces) {
    if (p.type === 'phone') found.push({ index: p.start, value: text.slice(p.start, p.end) });
  }
  for (const m of text.matchAll(PHONE_PATTERN)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (!phoneValid(m[0])) continue;
    // Внутри разобранной цепочки уже всё найдено точнее.
    if (insideChain(chains, start, end)) continue;
    found.push({ index: start, value: m[0] });
  }
  return found;
}

// (?<![\d+]): длинный номер «+7…» не должен попадать в кандидаты карт.
// Границы — только по цифрам (не \b): при склейке строк к номеру карты
// прилипают буквы («…6781Следующая строка» или латиница), и \b рядом
// с латинской буквой не срабатывал.
const CARD_PATTERN = /(?<![\d+])\d(?:[ -]?\d){12,18}(?!\d)/g;

/** Поиск карт: Луна + префикс платёжной системы, плюс карты из склеенных цепочек. */
export function findCards(text: string): DetectorMatch[] {
  const chains = gluedChains(text);
  const found: DetectorMatch[] = [];
  for (const p of chains.pieces) {
    if (p.type === 'credit_card') found.push({ index: p.start, value: text.slice(p.start, p.end) });
  }
  CARD_PATTERN.lastIndex = 0;
  for (const m of text.matchAll(CARD_PATTERN)) {
    const start = m.index!;
    if (insideChain(chains, start, start + m[0].length)) continue;
    if (luhnValid(m[0]) && cardScheme(m[0]) !== null) found.push({ index: start, value: m[0] });
  }
  return found;
}

/**
 * Detector order matters: more specific / higher-confidence detectors come
 * first so they win when two matches overlap (see overlap resolution in the
 * engine).
 */
export const DETECTORS: readonly Detector[] = [
  {
    id: 'private-key-pem',
    type: 'private_key',
    pattern: () =>
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: 'aws-access-key-id',
    type: 'api_key',
    pattern: () => /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: 'github-token',
    type: 'token',
    pattern: () => /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  },
  {
    id: 'openai-key',
    type: 'api_key',
    pattern: () => /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'slack-token',
    type: 'token',
    pattern: () => /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: 'stripe-key',
    type: 'api_key',
    pattern: () => /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    id: 'database-url-password',
    type: 'secret',
    pattern: () =>
      /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/[^\s:@/]+:[^\s@/]+@[^\s"'<>]+/g,
  },
  {
    id: 'jwt',
    type: 'token',
    pattern: () => /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },
  {
    // After `jwt` so a "Bearer eyJ…" header keeps the readable Bearer prefix.
    id: 'bearer-token',
    type: 'token',
    pattern: () => /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
    // Prose false positives ("Bearer of_the_ring…") lack digits.
    validate: (value) => /\d/.test(value),
  },
  {
    id: 'email',
    type: 'email',
    pattern: () => /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  // Российские документы — раньше карт и телефонов: их цифры не должны
  // достаться менее точным детекторам при пересечении.
  {
    id: 'snils',
    type: 'snils',
    notInsideIdentifier: true,
    pattern: snilsPattern,
    validate: snilsValid,
  },
  {
    id: 'passport-ru',
    type: 'passport',
    notInsideIdentifier: true,
    pattern: passportPattern,
    validate: (value) => passportValid(value),
  },
  {
    // До `credit-card`: 16–19 цифр из середины 20-значного счёта не должны
    // стать «картой».
    id: 'bank-account-ru',
    type: 'bank_account',
    notInsideIdentifier: true,
    find: findBankAccounts,
  },
  {
    // Before `credit-card` so the digit run inside an IBAN never wins overlap.
    id: 'iban',
    type: 'iban',
    pattern: () => /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g,
    validate: ibanValid,
  },
  {
    id: 'credit-card',
    type: 'credit_card',
    notInsideIdentifier: true,
    // Луна + префикс платёжной системы (Visa, Mastercard, МИР и др.).
    find: findCards,
  },
  {
    id: 'ipv4',
    type: 'ip_address',
    // Раньше по краям стояло \b. Граница слова есть только между «словесным»
    // символом (цифра, латиница, _) и остальными, поэтому IP, к которому
    // прилипли цифры или латиница («192.168.1.15012» после вставки, где
    // пропал перенос строки, или «host192.168.0.1»), не находился вовсе:
    // \b не выполнялся ни при каком разбиении на октеты.
    // Теперь края проверяются только по точкам: IP не может продолжать
    // цепочку «.цифры» слева и переходить в «(цифры).цифра» справа, чтобы не
    // выдёргивать 4 числа из длинной цепочки — версии «1.2.3.4.5» или
    // телефона с точками «8.999.123.45.67». Прилипшие цифры остаются снаружи:
    // октет берётся максимально длинным (≤ 255), так что маска накрывает
    // любой вариант того, где на самом деле кончался IP.
    pattern: () =>
      /(?<!\.\d{0,3})(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\d*\.\d)/g,
  },
  {
    id: 'uuid',
    type: 'uuid',
    pattern: () =>
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  },
  {
    // До телефона: номер дома в адресе не должен стать частью номера телефона.
    id: 'address-ru',
    type: 'address_ru',
    find: findRussianAddresses,
  },
  {
    // id оставлен прежним: на него ссылаются переводы и сохранённые
    // пользователем «доверенные значения» (TrustedValue.detector).
    id: 'phone-e164',
    type: 'phone',
    notInsideIdentifier: true,
    find: findPhones,
  },
  {
    // Last: generic fallback for secrets no specific detector recognises.
    id: 'high-entropy-string',
    type: 'secret',
    pattern: () => /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{24,}(?![A-Za-z0-9+/=_-])/g,
    validate: highEntropyValid,
  },
];
