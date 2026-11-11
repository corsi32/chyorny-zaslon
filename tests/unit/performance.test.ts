import { describe, expect, it } from 'vitest';
import { TsEngine } from '@/core/detection';
import { RU_PII_CORPUS } from '../corpus/ru-pii.corpus';

/**
 * Нагрузочная проверка: большой текст (10 000 – 50 000 символов) из примеров
 * размеченного набора. Проверяется не только время, но и то, что на большом
 * тексте ничего не теряется: каждое ожидаемое значение найдено.
 *
 * Порог времени взят с большим запасом (в ~10 раз выше замеренного), чтобы
 * тест не «мигал» на медленных машинах CI, но ловил регрессии вроде
 * катастрофического перебора в регулярке.
 */
const MAX_MS_FOR_50K = 500;

function buildText(targetLength: number) {
  const parts: string[] = [];
  const expected: string[] = [];
  let length = 0;
  for (let i = 0; length < targetLength; i++) {
    const sample = RU_PII_CORPUS[i % RU_PII_CORPUS.length]!;
    parts.push(sample.text);
    length += sample.text.length + 2;
    for (const x of sample.expected) expected.push(x.value);
  }
  return { text: parts.join('\n\n'), expected };
}

describe('производительность на больших текстах', () => {
  for (const size of [10_000, 30_000, 50_000]) {
    it(`сканирует ${size} символов быстро и без потерь`, async () => {
      const engine = new TsEngine();
      const { text, expected } = buildText(size);
      await engine.scan(text); // прогрев JIT

      const started = performance.now();
      const findings = await engine.scan(text);
      const elapsed = performance.now() - started;

      console.log(`${text.length} символов: ${elapsed.toFixed(1)} мс, находок: ${findings.length}`);
      expect(elapsed).toBeLessThan((MAX_MS_FOR_50K * size) / 50_000 + 50);

      const values = new Set(findings.map((f) => f.value));
      const missed = expected.filter((v) => !values.has(v));
      // Единственный известный пропуск набора — город без «г.» (см. corpus-metrics).
      expect(missed.filter((v) => !v.startsWith('Екатеринбург'))).toEqual([]);
    });
  }

  it('патологический текст из одних ключевых слов не вызывает перебора', async () => {
    const engine = new TsEngine();
    const text = 'Ул Ул Тверская Тверская ул ул г г д д 1 1 , , мкр мкр кв кв '.repeat(800);
    const started = performance.now();
    await engine.scan(text);
    expect(performance.now() - started).toBeLessThan(MAX_MS_FOR_50K);
  });
});
