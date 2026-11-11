// Изменено в проекте «Чёрный заслон», 2026: тесты телефонов РФ, IPv4 и лимитов движка. Подробнее — в NOTICE.
import { describe, expect, it } from 'vitest';
import { DETECTORS, MAX_MATCHES_PER_DETECTOR, TsEngine } from '@/core/detection';
import { createEngine } from '@/core/storage';

const engine = new TsEngine();

describe('TsEngine', () => {
  it('returns nothing for clean text', async () => {
    expect(await engine.scan('just a normal sentence')).toEqual([]);
    expect(await engine.scan('')).toEqual([]);
  });

  it('detects an email with correct bounds', async () => {
    const text = 'write to john.doe@example.com please';
    const findings = await engine.scan(text);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.type).toBe('email');
    expect(text.slice(f!.start, f!.end)).toBe('john.doe@example.com');
  });

  it('detects API keys and tokens', async () => {
    const findings = await engine.scan('key sk-abcdefghijklmnopqrstuvwx and AKIAIOSFODNN7EXAMPLE');
    const types = findings.map((f) => f.type).sort();
    expect(types).toEqual(['api_key', 'api_key']);
  });

  it('validates credit cards with Luhn', async () => {
    const valid = await engine.scan('card 4242 4242 4242 4242');
    expect(valid.some((f) => f.type === 'credit_card')).toBe(true);

    const invalid = await engine.scan('card 1234 5678 9012 3456');
    expect(invalid.some((f) => f.type === 'credit_card')).toBe(false);
  });

  it('detects Stripe keys', async () => {
    // Пример ключа из документации Stripe. Строка собирается из частей, чтобы
    // сканер секретов GitHub не принимал тестовые данные за настоящий ключ.
    const findings = await engine.scan(`use ${'sk_' + 'live_'}4eC39HqLyjWDarjtT1zdp7dc`);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detector).toBe('stripe-key');
    expect(findings[0]!.type).toBe('api_key');
  });

  it('detects database URLs with embedded passwords', async () => {
    const text = 'db is postgres://admin:s3cret@db.internal:5432/app ok';
    const findings = await engine.scan(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detector).toBe('database-url-password');
    expect(findings[0]!.value).toBe('postgres://admin:s3cret@db.internal:5432/app');
  });

  it('detects bearer tokens but not bearer prose', async () => {
    const hit = await engine.scan('Authorization: Bearer AbC123xYz456QrS789tUv012');
    expect(hit.some((f) => f.detector === 'bearer-token')).toBe(true);

    const miss = await engine.scan('the Bearer of_unfortunate_news arrived');
    expect(miss).toEqual([]);
  });

  it('keeps the Bearer prefix readable when the token is a JWT', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVP';
    const findings = await engine.scan(`Bearer ${jwt}`);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detector).toBe('jwt');
    expect(findings[0]!.value).toBe(jwt);
  });

  it('validates IBANs with the mod-97 checksum', async () => {
    const valid = await engine.scan('pay to DE89 3704 0044 0532 0130 00 today');
    expect(valid).toHaveLength(1);
    expect(valid[0]!.type).toBe('iban');

    const invalid = await engine.scan('pay to DE89 3704 0044 0532 0130 01 today');
    expect(invalid.some((f) => f.type === 'iban')).toBe(false);
  });

  it('detects international and Russian phone formats', async () => {
    const phoneExamples = [
      '+12345678901',
      '+7 (999) 123-45-67',
      '+375 29 123-45-67',
      '89991234567',
      '79991234567',
      '8 999 123 45 67',
      '8(999)123-45-67',
      '8-800-555-35-35',
      '8 (495) 777-88-99',
      '8 (705) 123-45-67',
      '8 (3452) 12-34-56',
      '(495) 123-45-67',
      '495 123-45-67',
      '88005553535 доб. 102',
      '+7 999 123 45 67 доб. 5',
      '+74951234567 ext. 45',
    ];

    for (const phone of phoneExamples) {
      const findings = await engine.scan(`call me at ${phone} thanks`);
      const phones = findings.filter((f) => f.type === 'phone');
      expect(phones.map((f) => f.value), phone).toEqual([phone]);
    }
  });

  it('detects a 7-digit local number only after a phone keyword', async () => {
    const withKeyword = ['тел. 123-45-67', 'Тел.: 123-45-67', 'звоните 123-45-67', 'tel: 123-45-67'];
    for (const text of withKeyword) {
      const findings = await engine.scan(text);
      const phones = findings.filter((f) => f.type === 'phone');
      expect(phones.map((f) => f.value), text).toEqual(['123-45-67']);
    }
  });

  it('finds an IP glued to digits or letters (text pasted without line breaks)', async () => {
    const cases: [string, string][] = [
      // Прилипли цифры: маска берёт самый длинный допустимый октет (≤ 255).
      ['IP 192.168.1.15012 сервер', '192.168.1.150'],
      ['сервер10.0.0.5порт8080', '10.0.0.5'],
      ['host192.168.0.1', '192.168.0.1'],
      ['192.168.0.1port', '192.168.0.1'],
      ['5192.168.1.1 в логе', '192.168.1.1'],
      ['192.168.1.1:8080', '192.168.1.1'],
    ];
    for (const [text, ip] of cases) {
      const findings = await engine.scan(text);
      expect(findings.filter((f) => f.type === 'ip_address').map((f) => f.value), text).toEqual([
        ip,
      ]);
    }
  });

  it('does not take four numbers out of a longer dotted chain', async () => {
    for (const text of ['версия 1.2.3.4.5', 'см. п. 2.1.3', 'Дата 17.10.2026', 'pi = 3.14159']) {
      const findings = await engine.scan(text);
      expect(findings.filter((f) => f.type === 'ip_address'), text).toEqual([]);
    }
  });

  it('does not classify IP addresses as phone numbers', async () => {
    const findings = await engine.scan('server IP is 192.168.1.1 here');
    const phoneFindings = findings.filter((f) => f.type === 'phone');
    expect(phoneFindings).toHaveLength(0);
    expect(findings.some((f) => f.type === 'ip_address')).toBe(true);
  });

  it('does not classify dates, sums, document numbers or receipt codes as phone numbers', async () => {
    const falsePositives = [
      'Дата отчета: 12.10.2024',
      'Счёт от 2024-10-17',
      'лог 2024-10-17 12:30:45 INFO',
      'Артикул товара: 123-45-67',
      'Сумма 1 250 000 руб.',
      'Заказ № 123 456 789',
      'Штрихкод: 8999123456789',
      'Штрихкод 4600123456789',
      'ИНН: 773119257500',
      'ИНН продавца: 463248901598',
      'ФПД: 3829104859',
      'ФН 9960440300123456',
      'ОГРН 1027700132195',
      // Пока нет своих детекторов (недели 5–7), но и телефоном они быть не должны.
      'СНИЛС 112-233-445 95',
      'Паспорт 45 12 123456',
      // Сплошные 11 цифр с городским кодом не принимаются намеренно: без
      // разделителей это чаще номер документа, чем телефон.
      'код 84951234567',
    ];

    for (const text of falsePositives) {
      const findings = await engine.scan(text);
      const phoneFindings = findings.filter((f) => f.type === 'phone');
      expect(phoneFindings, text).toHaveLength(0);
    }
  });

  it('finds a phone at the end of a long log full of numbers', async () => {
    const line = 'Привет, вот лог: 2024-10-17 12:30:45 INFO user=12345 took 345 ms id 9876543 ';
    const text = `${line.repeat(700)}тел 89991234567`;
    expect(text.length).toBeGreaterThan(50_000);

    const findings = await engine.scan(text, { budgetMs: 60_000 });
    const phones = findings.filter((f) => f.type === 'phone');
    expect(phones.map((f) => f.value)).toEqual(['89991234567']);
  });

  it('detects generic high-entropy secrets without flagging identifiers', async () => {
    const secret = await engine.scan('value q7PzR2wXv9Lk4TmB8sYd1NcJ here');
    expect(secret).toHaveLength(1);
    expect(secret[0]!.detector).toBe('high-entropy-string');
    expect(secret[0]!.type).toBe('secret');

    expect(await engine.scan('call getUserAccountManager123 now')).toEqual([]);
    expect(await engine.scan('internationalizationandlocalization')).toEqual([]);
  });

  it('respects the type filter', async () => {
    const findings = await engine.scan('a@b.com +1 415 555 1234', { types: ['email'] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('email');
  });

  it('detects custom rules when wired through createEngine', async () => {
    const customEngine = createEngine([
      {
        id: 'proj',
        name: 'Project id',
        pattern: String.raw`\bPRJ-\d{3}\b`,
        enabled: true,
      },
    ]);
    const findings = await customEngine.scan('use PRJ-007 here', { types: ['custom'] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('custom');
  });

  it('produces non-overlapping findings sorted by position', async () => {
    const findings = await engine.scan('id 550e8400-e29b-41d4-a716-446655440000 mail x@y.io');
    for (let i = 1; i < findings.length; i++) {
      expect(findings[i]!.start).toBeGreaterThanOrEqual(findings[i - 1]!.end);
    }
  });

  it('starts the budget clock at custom detectors, not at the built-in ones', async () => {
    // Built-in detectors on a long text take far longer than the 5 ms budget;
    // the custom rule after them must still get its own time.
    const custom = { id: 'proj', type: 'custom' as const, pattern: () => /\bPRJ-\d{3}\b/g };
    const withCustom = new TsEngine([...DETECTORS, custom]);
    const text = `${'г. Москва, ул. Тверская, д. 1, тел. 8 (999) 123-45-67. '.repeat(1500)} PRJ-007`;
    const findings = await withCustom.scan(text, { budgetMs: 5 });
    expect(findings.some((f) => f.type === 'custom' && f.value === 'PRJ-007')).toBe(true);
  });

  it('skips custom detectors but not built-in ones when the scan budget is exhausted', async () => {
    const custom = { id: 'proj', type: 'custom' as const, pattern: () => /\bPRJ-\d{3}\b/g };
    const withCustom = new TsEngine([...DETECTORS, custom]);
    const findings = await withCustom.scan('mail a@b.com about PRJ-007', { budgetMs: 0 });
    expect(findings.map((f) => f.type)).toEqual(['email']);
  });

  it('caps matches from a single detector', async () => {
    const greedy = new TsEngine([
      { id: 'dot', type: 'custom', pattern: () => /./g },
    ]);
    const text = 'x'.repeat(MAX_MATCHES_PER_DETECTOR + 50);
    const findings = await greedy.scan(text, { budgetMs: 60_000 });
    expect(findings.length).toBeLessThanOrEqual(MAX_MATCHES_PER_DETECTOR);
  });

  it('does not let rejected candidates use up the match cap', async () => {
    const picky = new TsEngine([
      { id: 'digit', type: 'custom', pattern: () => /\d/g, validate: (v) => v === '7' },
    ]);
    const text = `${'1'.repeat(MAX_MATCHES_PER_DETECTOR + 50)}7`;
    const findings = await picky.scan(text, { budgetMs: 60_000 });
    expect(findings.map((f) => f.value)).toEqual(['7']);
  });
});
