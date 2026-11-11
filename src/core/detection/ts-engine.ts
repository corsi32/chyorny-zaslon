// Изменено в проекте «Чёрный заслон», 2026: детекторы с функцией find, нормализация текста, лимиты для встроенных детекторов, быстрая проверка пересечений, маскирование повторов. Подробнее — в NOTICE.
import { DETECTORS, type Detector, type DetectorMatch } from './detectors';
import { normalizeText, toSourceRange } from './normalize';
import type { DetectionEngine, Finding, ScanOptions } from './types';

/**
 * Default soft budget so custom / pathological regex cannot freeze the UI.
 * Applies to custom rules and Smart PII only: built-in detectors always run to
 * completion (see {@link BUILTIN_DETECTORS}).
 */
export const DEFAULT_SCAN_BUDGET_MS = 50;

/**
 * Cap on accepted findings from a single custom / Smart PII detector. Only
 * candidates that pass `validate` count towards it: otherwise noise rejected
 * by the validator (dates, IDs in a long log) used up the cap and real values
 * further in the text were silently skipped. The loop itself stays bounded by
 * the scan budget.
 */
export const MAX_MATCHES_PER_DETECTOR = 200;

/**
 * Cap for built-in detectors. Much higher, because a value that is found but
 * not masked is a leak: a 50 000-character table can easily hold more than
 * 200 phone numbers. The cap only guards against absurd inputs.
 */
export const MAX_MATCHES_BUILTIN = 5000;

/**
 * Built-in detectors are reviewed, have linear-time patterns and are covered
 * by performance tests, so the time budget does not cut them off. Before this
 * change a slow page or a long text could exhaust the budget early and later
 * detectors (phones, addresses) were silently skipped — the user saw "nothing
 * found" for text that did contain personal data.
 */
const BUILTIN_DETECTORS: ReadonlySet<Detector> = new Set(DETECTORS);
const BUILTIN_IDS: ReadonlySet<string> = new Set(DETECTORS.map((d) => d.id));

interface Candidate extends Finding {
  /** Lower = higher confidence (position in DETECTORS). */
  readonly priority: number;
}

function* candidatesOf(detector: Detector, text: string): Iterable<DetectorMatch> {
  if (detector.find) {
    yield* detector.find(text);
    return;
  }
  for (const match of text.matchAll(detector.pattern())) {
    if (match.index !== undefined) yield { index: match.index, value: match[0] };
  }
}

const IDENTIFIER_CHAR = /[A-Za-z_]/;

/** Latin letter or «_» right before AND right after — the value sits inside an identifier. */
function insideIdentifier(text: string, start: number, end: number): boolean {
  return IDENTIFIER_CHAR.test(text[start - 1] ?? '') && IDENTIFIER_CHAR.test(text[end] ?? '');
}

/**
 * Accepted findings kept sorted by start, so an overlap check is a binary
 * search instead of a scan over every accepted finding (that was O(n²) and
 * noticeable on texts with thousands of findings).
 */
class IntervalSet {
  private readonly items: Finding[] = [];

  /** Insert unless it overlaps an existing interval. Returns true if inserted. */
  tryAdd(f: Finding): boolean {
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.items[mid]!.start < f.start) lo = mid + 1;
      else hi = mid;
    }
    const prev = this.items[lo - 1];
    const next = this.items[lo];
    if (prev && prev.end > f.start) return false;
    if (next && next.start < f.end) return false;
    this.items.splice(lo, 0, f);
    return true;
  }

  toArray(): Finding[] {
    return this.items;
  }
}

/**
 * Above this many distinct values repeats are not propagated: each value costs
 * one pass over the text. Composer prompts stay far below it; only huge
 * attachments could reach it, and those are not checked by isMaskCommitted.
 */
export const MAX_PROPAGATED_VALUES = 300;

/**
 * Mask every exact repeat of a value that was found once.
 *
 * Several detectors decide by context: «123-45-67» is a phone only after
 * «тел.», eleven digits are a SNILS only after «СНИЛС», a value glued inside
 * a Latin identifier is skipped. When the same value occurs again without that
 * context, the second occurrence used to stay in the prompt — a leak — and
 * isMaskCommitted() (it checks that no original value remains in the composer)
 * then failed, so the masked message could not be sent at all.
 */
function propagateRepeats(source: string, accepted: IntervalSet): void {
  const byValue = new Map<string, Finding>();
  for (const f of accepted.toArray()) {
    // Only built-in detectors: custom rules and Smart PII keep their match cap.
    if (BUILTIN_IDS.has(f.detector) && !byValue.has(f.value)) byValue.set(f.value, f);
  }
  if (byValue.size > MAX_PROPAGATED_VALUES) return;
  for (const [value, f] of byValue) {
    for (let i = source.indexOf(value); i >= 0; i = source.indexOf(value, i + 1)) {
      accepted.tryAdd({ ...f, start: i, end: i + value.length });
    }
  }
}

/**
 * Pure-TypeScript regex detection engine (Phase 0). Same contract as the future
 * WASM engine. Overlapping matches are resolved in favour of the
 * higher-confidence detector, then the longer match.
 */
export class TsEngine implements DetectionEngine {
  private readonly detectors: readonly Detector[];

  constructor(detectors: readonly Detector[] = DETECTORS) {
    this.detectors = detectors;
  }

  async scan(source: string, opts?: ScanOptions): Promise<Finding[]> {
    if (!source) return [];
    // Detectors work on a normalized copy (NBSP → space, en dash → hyphen,
    // zero-width chars removed, …); findings are mapped back to `source`.
    const normalized = normalizeText(source);
    const text = normalized.text;
    const typeFilter = opts?.types ? new Set(opts.types) : null;
    const budgetMs = opts?.budgetMs ?? DEFAULT_SCAN_BUDGET_MS;
    // The budget guards against slow custom / Smart PII regexes, so its clock
    // starts when the first of them runs. Before, it counted the built-in
    // detectors too: on the first scan after page load (regexes not compiled
    // yet) they could use up all 50 ms on a slow machine, and the user's own
    // rules were silently skipped.
    let budgetStart: number | null = null;
    const timedOut = () => budgetStart !== null && performance.now() - budgetStart >= budgetMs;

    const candidates: Candidate[] = [];
    for (let priority = 0; priority < this.detectors.length; priority++) {
      const detector = this.detectors[priority]!;
      const builtin = BUILTIN_DETECTORS.has(detector);
      if (!builtin) {
        budgetStart ??= performance.now();
        if (timedOut()) continue;
      }
      if (typeFilter && !typeFilter.has(detector.type)) continue;
      const cap = builtin ? MAX_MATCHES_BUILTIN : MAX_MATCHES_PER_DETECTOR;
      let matchCount = 0;
      for (const { index, value } of candidatesOf(detector, text)) {
        if (matchCount >= cap || (!builtin && timedOut())) break;
        if (detector.notInsideIdentifier && insideIdentifier(text, index, index + value.length)) {
          continue;
        }
        if (detector.validate && !detector.validate(value)) continue;
        matchCount += 1;
        candidates.push({
          type: detector.type,
          value,
          start: index,
          end: index + value.length,
          detector: detector.id,
          priority,
        });
      }
    }

    // Greedy resolution: best detector first, then longest match.
    candidates.sort(
      (a, b) => a.priority - b.priority || b.value.length - a.value.length || a.start - b.start,
    );

    const accepted = new IntervalSet();
    for (const c of candidates) {
      const { start, end } = toSourceRange(normalized, c.start, c.end);
      accepted.tryAdd({
        type: c.type,
        // The original characters: masking and Restore must see exactly what the user typed.
        value: source.slice(start, end),
        start,
        end,
        detector: c.detector,
      });
    }
    propagateRepeats(source, accepted);
    return accepted.toArray();
  }
}
