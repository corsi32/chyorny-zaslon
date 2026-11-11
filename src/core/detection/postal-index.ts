import {
  POSTAL_INDEX_RU_COUNT,
  POSTAL_INDEX_RU_RUNS,
  POSTAL_INDEX_RU_UPDATED,
} from './data/postal-index-ru';

/**
 * Словарь российских почтовых индексов (справочник Почты России).
 *
 * Хранится как битовая карта на 900 000 значений (100000–999999): 1 бит на
 * индекс, ~110 КБ памяти, проверка — одна операция над байтом. Карта строится
 * лениво при первом обращении из сжатой записи в data/postal-index-ru.ts.
 */
const MIN = 100000;
const MAX = 999999;

let bits: Uint8Array | null = null;

function build(): Uint8Array {
  const map = new Uint8Array(Math.ceil((MAX - MIN + 1) / 8));
  let prevEnd = MIN;
  for (const token of POSTAL_INDEX_RU_RUNS.split(',')) {
    const [gap, len] = token.split('.');
    const start = prevEnd + parseInt(gap!, 36);
    const end = start + (len ? parseInt(len, 36) : 0);
    for (let v = start; v <= end; v++) {
      const offset = v - MIN;
      map[offset >> 3]! |= 1 << (offset & 7);
    }
    prevEnd = end;
  }
  return map;
}

/** true, если строка из 6 цифр есть в справочнике почтовых индексов. */
export function isRussianPostalIndex(value: string): boolean {
  if (!/^\d{6}$/.test(value)) return false;
  const n = Number(value);
  if (n < MIN || n > MAX) return false;
  bits ??= build();
  const offset = n - MIN;
  return (bits[offset >> 3]! & (1 << (offset & 7))) !== 0;
}

/** Сведения о версии словаря — для документации и тестов. */
export const POSTAL_INDEX_INFO = {
  updated: POSTAL_INDEX_RU_UPDATED,
  count: POSTAL_INDEX_RU_COUNT,
} as const;
