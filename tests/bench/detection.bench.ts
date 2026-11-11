import { bench, describe } from 'vitest';
import { DETECTORS, TsEngine } from '@/core/detection';
import { RU_PII_CORPUS } from '../corpus/ru-pii.corpus';

/**
 * Бенчмарк движка: `npm run bench`. Показывает, сколько операций в секунду
 * выполняет полный скан текста 50 000 символов и каждый детектор по отдельности.
 */
const text = RU_PII_CORPUS.map((s) => s.text)
  .join('\n\n')
  .repeat(20)
  .slice(0, 50_000);

describe('полный скан, 50 000 символов', () => {
  const engine = new TsEngine();
  bench('все встроенные детекторы', async () => {
    await engine.scan(text);
  });
});

describe('отдельные детекторы, 50 000 символов', () => {
  for (const detector of DETECTORS) {
    const engine = new TsEngine([detector]);
    bench(detector.id, async () => {
      await engine.scan(text);
    });
  }
});
