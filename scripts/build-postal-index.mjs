#!/usr/bin/env node
/**
 * Собирает словарь российских почтовых индексов для детектора адресов.
 *
 * Источник: эталонный справочник почтовых индексов объектов почтовой связи
 * ФГУП «Почта России» (https://www.pochta.ru/support/database/ops) в виде
 * JSON-выгрузки репозитория https://github.com/sanmai/pindx (Apache-2.0).
 *
 * Использование:
 *   git clone --depth 1 https://github.com/sanmai/pindx /tmp/pindx
 *   node scripts/build-postal-index.mjs /tmp/pindx
 *
 * Результат — src/core/detection/data/postal-index-ru.ts.
 *
 * Формат хранения: индексы отсортированы и сжаты в «серии» подряд идущих
 * значений. Каждая серия записана как `сдвиг[.длина]` в системе счисления
 * с основанием 36: сдвиг — от конца предыдущей серии (для первой — от 100000),
 * длина — сколько значений серия добавляет после первого. Серии разделены
 * запятыми. Так ~61 000 индексов занимают ~57 КБ текста вместо ~430 КБ.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = process.argv[2];
if (!repo) {
  console.error('Usage: node scripts/build-postal-index.mjs <path-to-pindx-clone>');
  process.exit(1);
}

const jsonDir = path.join(repo, 'docs', 'json');
const indices = new Set();
for (const name of readdirSync(jsonDir)) {
  // Файлы вида 101.json — список всех индексов с этим трёхзначным префиксом.
  if (!/^\d{3}\.json$/.test(name)) continue;
  for (const value of JSON.parse(readFileSync(path.join(jsonDir, name), 'utf8'))) {
    if (Number.isInteger(value) && value >= 100000 && value <= 999999) indices.add(value);
  }
}
const sorted = [...indices].sort((a, b) => a - b);
if (sorted.length < 10000) {
  console.error(`Suspiciously few indices (${sorted.length}); check the source path.`);
  process.exit(1);
}

const statusFile = path.join(repo, 'docs', '_data', 'status.yml');
const updated = /updated:\s*(\S+)/.exec(readFileSync(statusFile, 'utf8'))?.[1] ?? 'unknown';

const tokens = [];
let prevEnd = 100000;
for (let i = 0; i < sorted.length; ) {
  const start = sorted[i];
  let end = start;
  while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
    i += 1;
    end += 1;
  }
  i += 1;
  const gap = (start - prevEnd).toString(36);
  tokens.push(end > start ? `${gap}.${(end - start).toString(36)}` : gap);
  prevEnd = end;
}

const out = `// Сгенерировано scripts/build-postal-index.mjs — не редактировать вручную.
// Источник: эталонный справочник почтовых индексов ФГУП «Почта России»
// (выгрузка https://github.com/sanmai/pindx, Apache-2.0), данные от ${updated}.
// Индексов: ${sorted.length}. Формат описан в scripts/build-postal-index.mjs.

export const POSTAL_INDEX_RU_UPDATED = '${updated}';
export const POSTAL_INDEX_RU_COUNT = ${sorted.length};

export const POSTAL_INDEX_RU_RUNS =
  '${tokens.join(',')}';
`;

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '..', 'src', 'core', 'detection', 'data', 'postal-index-ru.ts');
writeFileSync(target, out);
console.log(`Wrote ${sorted.length} indices (${tokens.length} runs, data ${updated}) to ${target}`);
