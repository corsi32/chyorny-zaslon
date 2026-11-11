import { describe, expect, it } from 'vitest';
import { TsEngine } from '@/core/detection';
import { isMaskCommitted, maskText, restoreText } from '@/core/masking';

/**
 * Проверка устойчивости на случайных строках (генератор с фиксированным
 * зерном — результат воспроизводим). Строки собираются из «опасных»
 * кусочков: цифр, разделителей, двойников пробелов и дефисов, невидимых
 * символов, букв и ключевых слов адресов и документов. Проверяются
 * инварианты, которые должны выполняться на ЛЮБОМ тексте:
 *  - движок не падает и укладывается во время;
 *  - находка — это ровно тот кусок исходного текста, на который она указывает;
 *  - находки не пересекаются и идут по порядку;
 *  - маскирование + восстановление возвращают исходный текст.
 */

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  '0', '1', '2', '4', '5', '7', '8', '9', '89991234567', '8 (999) ', '123-45-67', '+7', '+44 ', '2200 ',
  ' ', ' ', '-', '.', ',', '(', ')', '/', ':', '\n', '\u00a0', '\u2011', '\u2013', '\u200b', '\uff18',
  'г. ', 'ул. ', 'д. ', 'кв. ', 'мкр. ', 'под. ', 'эт. ', '№', 'Москва', 'Тверская', 'тел. ', 'доб. ',
  'СНИЛС ', 'паспорт ', 'серия ', 'р/с ', 'a', 'Z', '_', 'привет', 'ext. ', '{{', '}}', '@', 'mail.ru',
];

function randomText(rand: () => number, length: number): string {
  let s = '';
  while (s.length < length) s += PIECES[Math.floor(rand() * PIECES.length)];
  return s;
}

describe('устойчивость на случайном тексте', () => {
  it('инварианты движка и маскирования держатся на 3000 случайных строках', async () => {
    const engine = new TsEngine();
    // Прогрев: первый скан компилирует регулярки, и это время к устойчивости
    // отношения не имеет (на медленной машине при параллельных тестах — сотни мс).
    await engine.scan(PIECES.join(' '), { budgetMs: 60_000 });
    const rand = rng(2026);
    const problems: string[] = [];
    let slowest = 0;

    for (let i = 0; i < 3000 && problems.length < 5; i++) {
      const text = randomText(rand, 20 + Math.floor(rand() * 200));
      const started = performance.now();
      const findings = await engine.scan(text, { budgetMs: 60_000 });
      slowest = Math.max(slowest, performance.now() - started);

      let prevEnd = 0;
      for (const f of findings) {
        if (text.slice(f.start, f.end) !== f.value) problems.push(`slice ≠ value: ${JSON.stringify(text)}`);
        if (f.start < prevEnd) problems.push(`overlap/order: ${JSON.stringify(text)}`);
        if (f.value.length === 0) problems.push(`empty finding: ${JSON.stringify(text)}`);
        prevEnd = f.end;
      }
      const { masked, mappings } = maskText(text, findings, 'fz');
      if (!isMaskCommitted(masked, mappings)) problems.push(`mask not committed: ${JSON.stringify(text)}`);
      if (restoreText(masked, mappings) !== text) problems.push(`restore ≠ source: ${JSON.stringify(text)}`);
    }

    expect(problems).toEqual([]);
    // Порог с большим запасом: строка до 220 символов сканируется за доли
    // миллисекунды, а катастрофический перебор в регулярке дал бы секунды.
    // Запас нужен, чтобы тест не «мигал» от пауз сборщика мусора на медленной машине.
    expect(slowest).toBeLessThan(1000);
  });
});
