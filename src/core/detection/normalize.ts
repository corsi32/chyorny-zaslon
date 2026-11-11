/*
 * Нормализация текста перед поиском.
 *
 * Текст из Word, с сайтов, из PDF и мессенджеров внешне не отличается от
 * набранного руками, но вместо обычных символов в нём «двойники»:
 * неразрывный пробел (Word ставит его в номерах телефонов), неразрывный
 * дефис, тире, минус, невидимые символы нулевой ширины, полноширинные цифры.
 * Ни одна регулярка детекторов их не ждёт — значение уходило без маски.
 *
 * Вместо того чтобы учить каждый детектор всем двойникам, движок ищет в
 * нормализованной копии текста, а найденные позиции переводит обратно в
 * исходный текст. Маска ложится на исходные символы, восстановление
 * (Restore) возвращает исходные — пользователь ничего не теряет.
 */

/** Символы, заменяемые один к одному. */
const REPLACE: Readonly<Record<string, string>> = {
  // Пробелы: неразрывный, узкий неразрывный, цифровой, тонкий, en/em-пробелы и др.
  '\u00a0': ' ',
  '\u2000': ' ',
  '\u2001': ' ',
  '\u2002': ' ',
  '\u2003': ' ',
  '\u2004': ' ',
  '\u2005': ' ',
  '\u2006': ' ',
  '\u2007': ' ',
  '\u2008': ' ',
  '\u2009': ' ',
  '\u200a': ' ',
  '\u202f': ' ',
  '\u205f': ' ',
  '\u3000': ' ',
  // Дефисы, тире, минус.
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2212': '-',
  '\ufe58': '-',
  '\ufe63': '-',
  '\uff0d': '-',
  // Полноширинные знаки (японская/китайская раскладка).
  '\uff0b': '+',
  '\uff08': '(',
  '\uff09': ')',
  '\uff0e': '.',
  '\uff0c': ',',
  '\uff1a': ':',
  '\uff0f': '/',
};

/** Невидимые символы, которые удаляются: нулевой ширины, мягкий перенос, BOM. */
const REMOVE = new Set(['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad']);

/** Быстрая проверка: есть ли в тексте хоть один символ, требующий нормализации. */
const NEEDS_NORMALIZATION =
  /[\u00a0\u2000-\u200d\u2010-\u2015\u202f\u205f\u2060\u2212\u3000\ufe58\ufe63\ufeff\uff08-\uff1a\u00ad]/;

export interface NormalizedText {
  /** Текст, в котором ищут детекторы. */
  readonly text: string;
  /**
   * map[i] — позиция в исходном тексте символа text[i]; map[text.length] —
   * длина исходного текста. null — текст не менялся, позиции совпадают.
   */
  readonly map: readonly number[] | null;
}

export function normalizeText(source: string): NormalizedText {
  if (!NEEDS_NORMALIZATION.test(source)) return { text: source, map: null };
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (REMOVE.has(ch)) continue;
    const code = ch.charCodeAt(0);
    // Полноширинные цифры ０–９ → 0–9.
    const mapped =
      code >= 0xff10 && code <= 0xff19 ? String.fromCharCode(code - 0xff10 + 48) : (REPLACE[ch] ?? ch);
    out += mapped;
    map.push(i);
  }
  map.push(source.length);
  return { text: out, map };
}

/** Перевести диапазон [start, end) нормализованного текста в исходный. */
export function toSourceRange(
  normalized: NormalizedText,
  start: number,
  end: number,
): { start: number; end: number } {
  const { map } = normalized;
  if (!map) return { start, end };
  // Конец — сразу после последнего символа значения в исходном тексте, чтобы
  // невидимые символы, стоящие после значения, в маску не попадали.
  return { start: map[start]!, end: end > start ? map[end - 1]! + 1 : map[start]! };
}
