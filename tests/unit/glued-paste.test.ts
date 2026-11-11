import { describe, expect, it } from 'vitest';
import { TsEngine, type Finding } from '@/core/detection';
import { EVALUATED_TYPES, RU_PII_CORPUS, type CorpusEntity } from '../corpus/ru-pii.corpus';

/**
 * Текст, вставленный в чат с потерянными переносами строк (так ведёт себя,
 * например, поле ввода Gemini при вставке списка): строки склеиваются, и
 * к значению прилипают цифры и буквы соседних строк.
 *
 * Для маскирования важнее всего, чтобы ни одно значение не ушло открытым,
 * поэтому здесь проверяется ПОКРЫТИЕ: каждое ожидаемое значение должно
 * целиком лежать внутри находки того же типа. Находка может быть чуть шире
 * (прилипшая цифра попадает под маску) — это допустимо, утечка — нет.
 */

const engine = new TsEngine();

interface Span {
  readonly type: CorpusEntity['type'];
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

function covered(span: Span, findings: readonly Finding[]): boolean {
  return findings.some((f) => f.type === span.type && f.start <= span.start && f.end >= span.end);
}

/** Склеить строки, как при вставке без переносов. */
const glue = (lines: readonly string[]) => lines.join('');

/** Текст со скриншота: тестовый список, вставленный в Gemini (переносы пропали). */
const GEMINI_LIST = glue([
  '1. Должны маскироваться (Реальные номера)',
  'Слитные мобильные (российские):',
  '89991234567',
  '89167778899',
  'Слитные бесплатные:',
  '88005553535',
  'Форматированные с дефисами и пробелами:',
  '+7 (999) 123-45-67',
  '8-800-555-35-35',
  '8 (495) 777-88-99',
  'С добавочными номерами:',
  '88005553535 доб. 102',
  '+74951234567 ext. 45',
  'Международные:',
  '+12345678901',
  '+44 20 7946 0915',
  '2. НЕ должны маскироваться (Случайный мусор и ложные срабатывания)',
  'Случайные слитные 11-значные числа (без разделителей и с неверными кодами):',
  '77051762104',
  '74185296314',
  '84185296314',
  'Даты и версии (чтобы исключить их):',
  '2026.10.15',
  '1990.01.01',
  'IP-адреса и штрихкоды:',
  '192.168.1.1',
  '4600123456789',
  'Прогони этот список в расширении и проверь, подхватываются ли нужные форматы!',
]);

/** Находит каждое значение по порядку, начиная с позиции предыдущего. */
function spansOf(text: string, entities: readonly CorpusEntity[]): Span[] {
  const spans: Span[] = [];
  let from = 0;
  for (const e of entities) {
    const start = text.indexOf(e.value, from);
    if (start < 0) throw new Error(`value not in text: ${e.value}`);
    spans.push({ type: e.type, value: e.value, start, end: start + e.value.length });
    from = start;
  }
  return spans;
}

describe('склеенная вставка (пропали переносы строк)', () => {
  it('маскирует все номера из списка со скриншота Gemini', async () => {
    const expected: CorpusEntity[] = [
      { type: 'phone', value: '89991234567' },
      { type: 'phone', value: '89167778899' },
      { type: 'phone', value: '88005553535' },
      { type: 'phone', value: '+7 (999) 123-45-67' },
      { type: 'phone', value: '8-800-555-35-35' },
      { type: 'phone', value: '8 (495) 777-88-99' },
      { type: 'phone', value: '88005553535 доб. 102' },
      { type: 'phone', value: '+74951234567 ext. 45' },
      { type: 'phone', value: '+12345678901' },
      { type: 'phone', value: '+44 20 7946 0915' },
      { type: 'ip_address', value: '192.168.1.1' },
    ];
    const findings = await engine.scan(GEMINI_LIST);
    const leaks = spansOf(GEMINI_LIST, expected).filter((s) => !covered(s, findings));
    expect(leaks.map((s) => s.value)).toEqual([]);
  });

  it('не маскирует мусор из второй половины списка и не путает номер с картой', async () => {
    const findings = await engine.scan(GEMINI_LIST);
    const garbageStart = GEMINI_LIST.indexOf('2. НЕ должны');
    // «2» из «2. НЕ должны» прилипает к британскому номеру — под маску телефона
    // она попадает вместе с ним, это допустимо. Всё, что дальше, — мусор,
    // кроме IP-адреса.
    const afterUk = findings.filter((f) => f.end > garbageStart + 1 && f.type !== 'ip_address');
    expect(afterUk.map((f) => `${f.type}:${f.value}`)).toEqual([]);
    expect(findings.some((f) => f.type === 'credit_card')).toBe(false);
  });

  it('разбирает список, где цифры одной строки прилипли к цифрам другой', async () => {
    // Ручная проверка в Gemini: строки «+44 20 7946 0915», «2200 7001 2345 6781»,
    // «89991234567», «89997654321» слиплись без единого разделителя.
    const text = 'Контакты: +44 20 7946 09152200 7001 2345 67818999123456789997654321';
    const findings = await engine.scan(text);
    expect(findings.map((f) => `${f.type}:${f.value}`)).toEqual([
      'phone:+44 20 7946 0915',
      'credit_card:2200 7001 2345 6781',
      'phone:89991234567',
      'phone:89997654321',
    ]);
    // Две карты подряд и карта перед номером.
    expect((await engine.scan('4242 4242 4242 42422200 7001 2345 6781')).map((f) => f.type)).toEqual([
      'credit_card',
      'credit_card',
    ]);
    expect(
      (await engine.scan('2200 7001 2345 6781+7 999 123-45-67')).map((f) => `${f.type}:${f.value}`),
    ).toEqual(['credit_card:2200 7001 2345 6781', 'phone:+7 999 123-45-67']);
  });

  it('не режет на карты и телефоны длинные числа, которые без остатка не делятся', async () => {
    for (const text of [
      'штрихкоды 4600123456789 4607001234567 4600000000017',
      'ИНН 773119257500 ОГРН 1027700132195',
      'номер 1234 5678 9012 3456 7890 1234',
    ]) {
      const findings = await engine.scan(text);
      expect(findings.filter((f) => ['phone', 'credit_card'].includes(f.type)), text).toEqual([]);
    }
  });

  it('находит значения, к которым прилипли слова соседних строк', async () => {
    const cases: [string, string, string][] = [
      ['бесплатные:88005553535Форматированные', 'phone', '88005553535'],
      ['доб. 102+74951234567 ext. 45Международные', 'phone', '+74951234567 ext. 45'],
      ['СНИЛС: 123-456-789 64Адрес регистрации', 'snils', '123-456-789 64'],
      ['паспорт 4510 номер 123456Паспорт выдан', 'passport', '4510 номер 123456'],
      ['лицевой счёт 40817810570000123456timestamp', 'bank_account', '40817810570000123456'],
      ['карта 2200 7001 2345 6781Следующая строка', 'credit_card', '2200 7001 2345 6781'],
      ['ул. Тверская, д. 7Заказ № 15', 'address_ru', 'ул. Тверская, д. 7'],
    ];
    for (const [text, type, value] of cases) {
      const findings = await engine.scan(text);
      expect(findings.filter((f) => f.type === type).map((f) => f.value), text).toEqual([value]);
    }
  });

  it('не принимает за данные цифры внутри латинских идентификаторов и хешей', async () => {
    const negatives = [
      'sha1 a3f89991234567bc0de2c1f3',
      'id=AbC4242424242424242xyz',
      'серийник SN4512123456',
      'git 5f3a9e1b2c4d6e8f0a1b3c5d7e9f1a2b3c4d5e6f',
      'файл IMG_20241017_123456.jpg',
      'build 20241017123045',
    ];
    for (const text of negatives) {
      const findings = await engine.scan(text);
      const digits = findings.filter((f) =>
        ['phone', 'credit_card', 'passport', 'snils', 'bank_account'].includes(f.type),
      );
      expect(digits.map((f) => `${f.type}:${f.value}`), text).toEqual([]);
    }
  });

  it('размеченный набор, склеенный попарно: ничего не утекает и не появляется лишнего', async () => {
    const leaks: string[] = [];
    const extra: string[] = [];
    // Известное ограничение: город без «г.» не входит в адрес (см. corpus-metrics).
    const known = (v: string) => v.startsWith('Екатеринбург');

    // Два вида: просто склеенный текст и склеенный текст из Word (неразрывные
    // пробелы и дефисы) — оба встречаются при копировании.
    const plain = (t: string) => t;
    const word = (t: string) => t.replace(/ /g, '\u00a0').replace(/-/g, '\u2011');
    for (const style of [plain, word])
    for (let i = 0; i + 1 < RU_PII_CORPUS.length; i++) {
      const parts = [RU_PII_CORPUS[i]!, RU_PII_CORPUS[i + 1]!];
      const text = style(glue(parts.map((p) => p.text.replace(/\n/g, ''))));
      const expected = parts
        .flatMap((p) => p.expected)
        .filter((x) => EVALUATED_TYPES.includes(x.type) && !known(x.value))
        .map((x) => ({ ...x, value: style(x.value.replace(/\n/g, '')) }));
      const findings = (await engine.scan(text)).filter((f) => EVALUATED_TYPES.includes(f.type));
      const spans = spansOf(text, expected);

      for (const s of spans) if (!covered(s, findings)) leaks.push(`${s.type}: ${s.value}  ←  ${text}`);
      for (const f of findings) {
        const overlapsExpected = spans.some((s) => f.start < s.end && s.start < f.end);
        const isKnown = known(f.value) || f.value.startsWith('ул.') && f.value.includes('Малышева');
        if (!overlapsExpected && !isKnown) extra.push(`${f.type}: ${f.value}  ←  ${text}`);
      }
    }
    if (leaks.length || extra.length) console.log([...leaks, ...extra].join('\n'));
    expect(leaks).toEqual([]);
    expect(extra).toEqual([]);
  });
});
