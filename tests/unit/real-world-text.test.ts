import { describe, expect, it } from 'vitest';
import { TsEngine, type FindingType } from '@/core/detection';
import { isMaskCommitted, maskText } from '@/core/masking';
import { EVALUATED_TYPES, RU_PII_CORPUS } from '../corpus/ru-pii.corpus';

/**
 * Текст, скопированный из Word, с сайтов, из PDF и мессенджеров. Внешне он
 * не отличается от набранного руками, но вместо обычных пробелов и дефисов
 * в нём «двойники»: неразрывный пробел, неразрывный дефис, тире, минус,
 * невидимые символы нулевой ширины, полноширинные цифры. Пользователь не
 * видит разницы, поэтому пропуск здесь — тихая утечка.
 */

const engine = new TsEngine();

const NBSP = '\u00a0';
const NB_HYPHEN = '\u2011';
const EN_DASH = '\u2013';
const MINUS = '\u2212';
const ZWSP = '\u200b';
const NARROW_NBSP = '\u202f';

async function valuesOf(text: string, type: FindingType): Promise<string[]> {
  return (await engine.scan(text)).filter((f) => f.type === type).map((f) => f.value);
}

/** Как Word: пробелы → неразрывные, дефисы → неразрывные дефисы. */
const asWord = (s: string) => s.replace(/ /g, NBSP).replace(/-/g, NB_HYPHEN);

describe('текст из Word, с сайтов и из PDF', () => {
  it('находит значения с неразрывными пробелами, тире и невидимыми символами', async () => {
    const cases: [string, FindingType, string][] = [
      [`тел. +7${NBSP}999${NBSP}123-45-67`, 'phone', `+7${NBSP}999${NBSP}123-45-67`],
      [`8${NBSP}(495)${NBSP}777${NB_HYPHEN}88${NB_HYPHEN}99`, 'phone', `8${NBSP}(495)${NBSP}777${NB_HYPHEN}88${NB_HYPHEN}99`],
      [`8 800 555${EN_DASH}35${EN_DASH}35`, 'phone', `8 800 555${EN_DASH}35${EN_DASH}35`],
      [`8 (999) 123${MINUS}45${MINUS}67`, 'phone', `8 (999) 123${MINUS}45${MINUS}67`],
      [`+7 999 123${ZWSP}45${ZWSP}67`, 'phone', `+7 999 123${ZWSP}45${ZWSP}67`],
      ['８９９９１２３４５６７', 'phone', '８９９９１２３４５６７'],
      [`СНИЛС 112${NBSP}233${NBSP}445${NBSP}95`, 'snils', `112${NBSP}233${NBSP}445${NBSP}95`],
      [`карта 2200${NARROW_NBSP}7001${NARROW_NBSP}2345${NARROW_NBSP}6781`, 'credit_card', `2200${NARROW_NBSP}7001${NARROW_NBSP}2345${NARROW_NBSP}6781`],
      [`паспорт 45${NBSP}12${NBSP}123456`, 'passport', `45${NBSP}12${NBSP}123456`],
      [`р/с${NBSP}40817810570000123456`, 'bank_account', '40817810570000123456'],
      [`192${ZWSP}.168.1.1`, 'ip_address', `192${ZWSP}.168.1.1`],
    ];
    for (const [text, type, value] of cases) {
      expect(await valuesOf(text, type), JSON.stringify(text)).toEqual([value]);
    }
  });

  it('возвращает позиции в исходном тексте: маска ложится ровно на значение', async () => {
    const text = `Звоните${ZWSP}${ZWSP}: 8${NBSP}999${NBSP}123${NB_HYPHEN}45${NB_HYPHEN}67, спасибо`;
    const [phone] = await engine.scan(text);
    expect(phone!.type).toBe('phone');
    expect(text.slice(phone!.start, phone!.end)).toBe(phone!.value);
    expect(phone!.value).toBe(`8${NBSP}999${NBSP}123${NB_HYPHEN}45${NB_HYPHEN}67`);
  });

  it('весь размеченный набор в «вордовском» виде даёт те же находки', async () => {
    const mismatches: string[] = [];
    for (const sample of RU_PII_CORPUS) {
      const plain = (await engine.scan(sample.text))
        .filter((f) => EVALUATED_TYPES.includes(f.type))
        .map((f) => `${f.type}:${asWord(f.value)}`);
      const word = asWord(sample.text);
      const fromWord = (await engine.scan(word))
        .filter((f) => EVALUATED_TYPES.includes(f.type))
        .map((f) => `${f.type}:${f.value}`);
      if (JSON.stringify(plain) !== JSON.stringify(fromWord)) {
        mismatches.push(`${sample.text}\n   обычный: ${plain.join(' | ')}\n   Word:    ${fromWord.join(' | ')}`);
      }
    }
    if (mismatches.length) console.log(mismatches.join('\n'));
    expect(mismatches).toEqual([]);
  });
});

describe('найденные при проверке случаи', () => {
  it('номер с точками \u2014 телефон, а не IP', async () => {
    for (const text of ['8.999.123.45.67', '+7.999.123.45.67']) {
      const findings = await engine.scan(text);
      expect(findings.map((f) => `${f.type}:${f.value}`), text).toEqual([`phone:${text}`]);
    }
    // Версия из пяти чисел — не IP, ни целиком, ни частью.
    expect(await valuesOf('версия 8.1.12.123.45', 'ip_address')).toEqual([]);
    // IP по-прежнему находится, в том числе склеенный с цифрами.
    expect(await valuesOf('сервер 192.168.1.1, порт 80', 'ip_address')).toEqual(['192.168.1.1']);
    expect(await valuesOf('5192.168.1.1 в логе', 'ip_address')).toEqual(['192.168.1.1']);
  });

  it('подъезд и этаж не обрывают адрес, квартира не утекает', async () => {
    const cases: [string, string][] = [
      [
        'г. Москва, ул. Тверская, д. 5, под. 3, эт. 4, кв. 56',
        'г. Москва, ул. Тверская, д. 5, под. 3, эт. 4, кв. 56',
      ],
      ['ул. Ленина, д. 5, подъезд 2, этаж 3, кв. 12', 'ул. Ленина, д. 5, подъезд 2, этаж 3, кв. 12'],
      ['ул. Ленина, д. 5, 2 этаж, кв. 12', 'ул. Ленина, д. 5, 2 этаж, кв. 12'],
      ['ул. Ленина, дом №5', 'ул. Ленина, дом №5'],
      ['ул. Ленина, д. № 5, кв. № 7', 'ул. Ленина, д. № 5, кв. № 7'],
    ];
    for (const [text, value] of cases) {
      expect(await valuesOf(text, 'address_ru'), text).toEqual([value]);
    }
    // Предлог «под» без точки — не подъезд.
    expect(await valuesOf('ул. Ленина, д. 5, под 3 метрами снега', 'address_ru')).toEqual([
      'ул. Ленина, д. 5',
    ]);
  });

  it('паспорт с запятой между серией и номером', async () => {
    expect(await valuesOf('паспорт: серия 4512, номер 123456', 'passport')).toEqual([
      '4512, номер 123456',
    ]);
    // Запятая без слова «номер» — это перечисление, а не паспорт.
    expect(await valuesOf('коды 4512, 123456', 'passport')).toEqual([]);
  });

  it('маскирует все повторы значения, найденного по контексту, и маска «фиксируется»', async () => {
    const cases: [string, number][] = [
      ['тел. 123-45-67, а ещё 123-45-67 в подписи', 2],
      ['СНИЛС 11223344595, повторяю: 11223344595', 2],
      ['р/с 40702810938000012345; на 40702810938000012345 не переводить', 2],
    ];
    for (const [text, count] of cases) {
      const findings = await engine.scan(text);
      expect(findings, text).toHaveLength(count);
      const { masked, mappings } = maskText(text, findings, 'rp');
      // Без этого расширение не отправит сообщение: в поле остаётся исходное значение.
      expect(isMaskCommitted(masked, mappings), masked).toBe(true);
    }
  });
});
