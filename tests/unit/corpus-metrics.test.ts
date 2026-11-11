import { describe, expect, it } from 'vitest';
import { TsEngine, type FindingType } from '@/core/detection';
import { EVALUATED_TYPES, RU_PII_CORPUS } from '../corpus/ru-pii.corpus';

/**
 * Метрики качества детекторов на размеченном наборе текстов.
 *
 *   точность (precision) = TP / (TP + FP) — какая доля срабатываний верна;
 *   полнота  (recall)    = TP / (TP + FN) — какая доля данных найдена.
 *
 * Совпадение засчитывается, только если совпали и тип, и точное значение:
 * найденный «кусок» адреса вместо целого адреса — это и FP, и FN.
 * Таблица печатается при каждом запуске `npm test`, пороги ниже — минимальные
 * требования, ниже которых сборка считается сломанной.
 */

interface Counts {
  tp: number;
  fp: number;
  fn: number;
}

const MIN_PRECISION = 0.95;
const MIN_RECALL = 0.95;

async function evaluate() {
  const engine = new TsEngine();
  const perType = new Map<FindingType, Counts>(
    EVALUATED_TYPES.map((t) => [t, { tp: 0, fp: 0, fn: 0 }]),
  );
  const errors: string[] = [];

  for (const sample of RU_PII_CORPUS) {
    const found = (await engine.scan(sample.text, { budgetMs: 60_000 }))
      .filter((f) => EVALUATED_TYPES.includes(f.type))
      .map((f) => `${f.type}\u0000${f.value}`);
    const expected = sample.expected.map((x) => `${x.type}\u0000${x.value}`);

    const remaining = [...expected];
    for (const key of found) {
      const type = key.split('\u0000')[0] as FindingType;
      const i = remaining.indexOf(key);
      if (i >= 0) {
        remaining.splice(i, 1);
        perType.get(type)!.tp += 1;
      } else {
        perType.get(type)!.fp += 1;
        errors.push(`FP ${key.replace('\u0000', ': ')}  ←  ${sample.text}`);
      }
    }
    for (const key of remaining) {
      perType.get(key.split('\u0000')[0] as FindingType)!.fn += 1;
      errors.push(`FN ${key.replace('\u0000', ': ')}  ←  ${sample.text}`);
    }
  }
  return { perType, errors };
}

const ratio = (a: number, b: number) => (b === 0 ? 1 : a / b);

describe('качество детекторов на размеченном наборе', () => {
  it(`точность и полнота не ниже ${MIN_PRECISION} / ${MIN_RECALL}`, async () => {
    const { perType, errors } = await evaluate();
    const total: Counts = { tp: 0, fp: 0, fn: 0 };
    const rows = [...perType].map(([type, c]) => {
      total.tp += c.tp;
      total.fp += c.fp;
      total.fn += c.fn;
      return {
        type,
        TP: c.tp,
        FP: c.fp,
        FN: c.fn,
        precision: ratio(c.tp, c.tp + c.fp).toFixed(3),
        recall: ratio(c.tp, c.tp + c.fn).toFixed(3),
      };
    });
    const precision = ratio(total.tp, total.tp + total.fp);
    const recall = ratio(total.tp, total.tp + total.fn);
    rows.push({
      type: 'ВСЕГО' as FindingType,
      TP: total.tp,
      FP: total.fp,
      FN: total.fn,
      precision: precision.toFixed(3),
      recall: recall.toFixed(3),
    });
    console.log(`Примеров в наборе: ${RU_PII_CORPUS.length}`);
    console.table(rows);
    if (errors.length) console.log(errors.join('\n'));

    expect(precision).toBeGreaterThanOrEqual(MIN_PRECISION);
    expect(recall).toBeGreaterThanOrEqual(MIN_RECALL);
  });
});
