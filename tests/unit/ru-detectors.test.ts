import { describe, expect, it } from 'vitest';
import { TsEngine, type FindingType } from '@/core/detection';
import { isRussianPostalIndex, POSTAL_INDEX_INFO } from '@/core/detection/postal-index';
import { findRussianAddresses } from '@/core/detection/ru-address';
import {
  bankAccountValid,
  cardScheme,
  passportValid,
  snilsValid,
} from '@/core/detection/ru-documents';

const engine = new TsEngine();

async function valuesOf(text: string, type: FindingType): Promise<string[]> {
  const findings = await engine.scan(text);
  return findings.filter((f) => f.type === type).map((f) => f.value);
}

/** Детерминированный генератор псевдослучайных чисел (mulberry32), чтобы тесты были воспроизводимы. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDigits(rand: () => number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(rand() * 10);
  return s;
}

/** Контрольное число СНИЛС — отдельная реализация «по определению» для генерации данных. */
function snilsControl(first9: string): number {
  const sum = [...first9].reduce((acc, ch, i) => acc + Number(ch) * (9 - i), 0);
  if (sum < 100) return sum;
  if (sum === 100 || sum === 101) return 0;
  const r = sum % 101;
  return r === 100 ? 0 : r;
}

function luhnCheckDigit(body: string): number {
  let sum = 0;
  for (let i = body.length - 1, double = true; i >= 0; i--, double = !double) {
    let d = Number(body[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

describe('почтовые индексы (словарь Почты России)', () => {
  it('знает реальные индексы и отклоняет несуществующие', () => {
    expect(isRussianPostalIndex('101000')).toBe(true); // Москва, Главпочтамт
    expect(isRussianPostalIndex('190000')).toBe(true); // Санкт-Петербург
    expect(isRussianPostalIndex('000000')).toBe(false);
    expect(isRussianPostalIndex('123456')).toBe(false);
    expect(isRussianPostalIndex('12345')).toBe(false);
    expect(POSTAL_INDEX_INFO.count).toBeGreaterThan(50_000);
  });
});

describe('адреса РФ', () => {
  const positives: [string, string][] = [
    ['Адрес: г. Москва, ул. Тверская, д. 1', 'г. Москва, ул. Тверская, д. 1'],
    [
      'Отправьте на 101000, г. Москва, ул. Мясницкая, д. 26, кв. 5.',
      '101000, г. Москва, ул. Мясницкая, д. 26, кв. 5',
    ],
    ['101000, Москва, ул. Мясницкая, 26', '101000, Москва, ул. Мясницкая, 26'],
    ['Москва, Тверская ул., 7', 'Москва, Тверская ул., 7'],
    [
      'Московская обл., г.о. Химки, мкр. Сходня, ул. Ленина, д. 5к2',
      'Московская обл., г.о. Химки, мкр. Сходня, ул. Ленина, д. 5к2',
    ],
    ['Респ. Татарстан, г. Казань, пр-кт Победы, д. 100, корп. 2, кв. 15', 'Респ. Татарстан, г. Казань, пр-кт Победы, д. 100, корп. 2, кв. 15'],
    ['Краснодарский край, ст-ца Ленинградская, ул. 8 Марта, 15а', 'Краснодарский край, ст-ца Ленинградская, ул. 8 Марта, 15а'],
    ['ул. 50 лет Октября, д. 3, стр. 1', 'ул. 50 лет Октября, д. 3, стр. 1'],
    ['Санкт-Петербург, Невский пр., 28', 'Санкт-Петербург, Невский пр., 28'],
    ['г Санкт-Петербург, наб. реки Мойки, д. 12', 'г Санкт-Петербург, наб. реки Мойки, д. 12'],
    ['Нижний Новгород г., ул. Большая Покровская, д. 1', 'Нижний Новгород г., ул. Большая Покровская, д. 1'],
    ['Ул. Ленина 5', 'Ул. Ленина 5'],
    ['Адрес доставки:\nг. Москва,\nул. Тверская, д. 1', 'г. Москва,\nул. Тверская, д. 1'],
    ['тер. СНТ Ромашка, уч. 15', 'тер. СНТ Ромашка, уч. 15'],
    ['д. Ивановка, д. 5', 'д. Ивановка, д. 5'],
    ['г. Зеленоград, корп. 1234', 'г. Зеленоград, корп. 1234'],
  ];

  it('собирает индекс, город, улицу и дом в один блок', async () => {
    for (const [text, expected] of positives) {
      expect(await valuesOf(text, 'address_ru'), text).toEqual([expected]);
    }
  });

  it('распознаёт адреса с микрорайонами', async () => {
    const cases: [string, string][] = [
      ['мкр. Северный, д. 5', 'мкр. Северный, д. 5'],
      ['3-й мкр., д. 12, кв. 40', '3-й мкр., д. 12, кв. 40'],
      ['г. Новосибирск, мкр Горский, 8', 'г. Новосибирск, мкр Горский, 8'],
      ['г. Тюмень, микрорайон Восточный-2, д. 7', 'г. Тюмень, микрорайон Восточный-2, д. 7'],
      ['г. Тольятти, 5 мкр, д. 3', 'г. Тольятти, 5 мкр, д. 3'],
    ];
    for (const [text, expected] of cases) {
      expect(await valuesOf(text, 'address_ru'), text).toEqual([expected]);
    }
  });

  it('не маскирует город, улицу или микрорайон без номера дома', async () => {
    const negatives = [
      'Живу в г. Кострома уже давно.',
      'Улица Ленина очень длинная.',
      'В 2024 г. Москва приняла решение',
      'Встретимся на пл. Ленина в 5',
      'См. с. 15 и п. 3 договора, д. 2 приложения',
      'Новый мкр. Северный строится быстро',
      'дом 5 и квартира 12',
      'Московская обл. и Краснодарский край',
    ];
    for (const text of negatives) {
      expect(await valuesOf(text, 'address_ru'), text).toEqual([]);
    }
  });

  it('не включает в адрес шестизначное число, которого нет в справочнике индексов', async () => {
    expect(await valuesOf('Заказ 123456, ул. Ленина, д. 5', 'address_ru')).toEqual([
      'ул. Ленина, д. 5',
    ]);
  });

  it('не съедает телефон, записанный сразу после адреса', async () => {
    const text = 'ул. Ленина, д. 5, тел. 8 (999) 123-45-67';
    const findings = await engine.scan(text);
    expect(findings.map((f) => [f.type, f.value])).toEqual([
      ['address_ru', 'ул. Ленина, д. 5'],
      ['phone', '8 (999) 123-45-67'],
    ]);
  });

  it('находит несколько адресов в одном тексте', () => {
    const text = 'Склад: г. Тверь, ул. Советская, д. 10. Офис: г. Москва, ул. Тверская, д. 1.';
    expect(findRussianAddresses(text).map((m) => m.value)).toEqual([
      'г. Тверь, ул. Советская, д. 10',
      'г. Москва, ул. Тверская, д. 1',
    ]);
  });
});

describe('СНИЛС', () => {
  it('принимает номера с верным контрольным числом в разных записях', async () => {
    for (const text of ['СНИЛС 112-233-445 95', '112-233-445-95', '112 233 445 95', 'СНИЛС: 11223344595']) {
      expect(await valuesOf(text, 'snils'), text).toHaveLength(1);
    }
  });

  it('не принимает 11 цифр подряд без слова «СНИЛС»', async () => {
    expect(await valuesOf('номер 11223344595', 'snils')).toEqual([]);
  });

  it('проверяет контрольное число на сгенерированных номерах', () => {
    const rand = rng(42);
    for (let i = 0; i < 2000; i++) {
      const first9 = String(1002000 + Math.floor(rand() * 998_000_000)).padStart(9, '0');
      const control = snilsControl(first9);
      const good = `${first9.slice(0, 3)}-${first9.slice(3, 6)}-${first9.slice(6)} ${String(control).padStart(2, '0')}`;
      const bad = `${good.slice(0, 12)}${String((control + 1) % 100).padStart(2, '0')}`;
      expect(snilsValid(good), good).toBe(true);
      expect(snilsValid(bad), bad).toBe(false);
    }
  });

  it('не проверяет номера до 001-001-998, для них контрольное число не определено', () => {
    expect(snilsValid('001-001-998 00')).toBe(false);
  });
});

describe('паспорт РФ', () => {
  const now = new Date('2026-10-18');

  it('находит серию и номер после слова «паспорт» или «серия»', async () => {
    const cases: [string, string][] = [
      ['паспорт 4512 123456', '4512 123456'],
      ['Паспорт: 45 12 123456', '45 12 123456'],
      ['паспорт 4512123456', '4512123456'],
      ['серия 4512 № 123456', '4512 № 123456'],
      ['серия 4512 номер 123456', '4512 номер 123456'],
    ];
    for (const [text, expected] of cases) {
      expect(await valuesOf(text, 'passport'), text).toEqual([expected]);
    }
  });

  it('без контекста принимает только запись «45 12 123456»', async () => {
    expect(await valuesOf('данные 45 12 123456', 'passport')).toEqual(['45 12 123456']);
    expect(await valuesOf('код 4512123456', 'passport')).toEqual([]);
    expect(await valuesOf('код 4512 123456', 'passport')).toEqual([]);
  });

  it('проверяет год изготовления бланка в серии', () => {
    expect(passportValid('4597 123456', now)).toBe(true);
    expect(passportValid('4500 123456', now)).toBe(true);
    expect(passportValid('4527 123456', now)).toBe(true); // текущий год + 1
    expect(passportValid('4528 123456', now)).toBe(false);
    expect(passportValid('4550 123456', now)).toBe(false);
    expect(passportValid('4596 123456', now)).toBe(false);
  });
});

describe('банковские счета', () => {
  it('со словом «р/с» или «счёт» принимает любой 20-значный счёт, кроме корсчёта', async () => {
    expect(await valuesOf('р/с 40702810900000012345', 'bank_account')).toEqual(['40702810900000012345']);
    expect(await valuesOf('Счёт № 40817 810 0 9999 1234567', 'bank_account')).toEqual([
      '40817 810 0 9999 1234567',
    ]);
    expect(await valuesOf('к/с 30101810400000000225', 'bank_account')).toEqual([]);
  });

  it('без слова-подсказки принимает только счета физлиц с известной валютой', async () => {
    expect(await valuesOf('переведи на 40817810099910004312', 'bank_account')).toEqual([
      '40817810099910004312',
    ]);
    expect(await valuesOf('id 40702810900000012345', 'bank_account')).toEqual([]);
    expect(await valuesOf('id 40817999099910004312', 'bank_account')).toEqual([]);
  });

  it('20 цифр счёта не превращаются в номер карты', async () => {
    const findings = await engine.scan('счёт 4081 7810 0999 1000 4312');
    expect(findings.map((f) => f.type)).toEqual(['bank_account']);
  });

  it('валидатор отклоняет не 20 цифр', () => {
    expect(bankAccountValid('4081781009991000431', true)).toBe(false);
  });
});

describe('банковские карты', () => {
  it('определяет платёжную систему по префиксу', () => {
    expect(cardScheme('2200 1234 5678 9012')).toBe('mir');
    expect(cardScheme('2204 0000 0000 0000 000')).toBe('mir');
    expect(cardScheme('4242 4242 4242 4242')).toBe('visa');
    expect(cardScheme('5555 5555 5555 4444')).toBe('mastercard');
    expect(cardScheme('2221 0000 0000 0009')).toBe('mastercard');
    expect(cardScheme('3782 822463 10005')).toBe('amex');
    expect(cardScheme('9999 9999 9999 9995')).toBeNull();
    expect(cardScheme('4242 4242 4242 42')).toBeNull(); // Visa не бывает 14-значной
  });

  it('находит сгенерированные карты «МИР» и отклоняет номера с неизвестным префиксом', async () => {
    const rand = rng(7);
    for (let i = 0; i < 300; i++) {
      const body = `220${Math.floor(rand() * 5)}${randomDigits(rand, 11)}`;
      const mir = body + luhnCheckDigit(body);
      const spaced = mir.replace(/(\d{4})(?=\d)/g, '$1 ');
      expect(await valuesOf(`карта ${spaced}`, 'credit_card'), spaced).toEqual([spaced]);

      const unknownBody = `9${randomDigits(rand, 14)}`;
      const unknown = unknownBody + luhnCheckDigit(unknownBody);
      expect(await valuesOf(`код ${unknown}`, 'credit_card'), unknown).toEqual([]);
    }
  });
});
