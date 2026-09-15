import type {
  BeforeInputSignal,
  KeySignal,
  SelectionMoveSignal,
  SelectionSnapshot,
} from "./ime-state-machine";

export interface TextRange {
  from: number;
  to: number;
}

export interface PseudoTransactionSignal {
  at: number;
  from: number;
  to: number;
  insert: string;
  deletedText: string;
  changeCount: number;
  userEvent: string | undefined;
  selectionBefore: SelectionSnapshot;
  sourceStillPresent: boolean;
}

export type PseudoDecision =
  | { kind: "allow" }
  | {
      kind: "suppress-stale-delete";
      originalText: string;
      range: TextRange;
      staleText: string;
    }
  | {
      kind: "atomic-repair";
      insert: string;
      replace: TextRange;
      staleText: string;
      originalText: string;
      source: "derived" | "pending-intended-key";
    }

export type AtomicRepairDecision = Extract<PseudoDecision, { kind: "atomic-repair" }>;

export interface PseudoDebugSnapshot {
  pseudoComposition: {
    active: boolean;
    lastRange: TextRange | null;
    lastText: string;
    lastRewriteTime: number | null;
    rewriteCount: number;
  };
  selectionMovedOutsidePseudoRange: boolean;
}

interface PendingDelete {
  at: number;
  range: TextRange;
  text: string;
}

interface PendingStaleDelete {
  at: number;
  originalText: string;
  range: TextRange;
  intendedKey: string;
}

interface MovedPseudoComposition {
  sourceRange: TextRange;
  sourceText: string;
  destination: SelectionSnapshot;
  intended?: { range: TextRange; text: string };
}

export const PSEUDO_REWRITE_PAIR_MS = 80;
export const PSEUDO_INPUT_ASSOCIATION_MS = 160;
export const PSEUDO_MIN_REWRITES = 2;

const COMPAT_LEADS = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;

const COMPAT_VOWELS = [
  "ㅏ",
  "ㅐ",
  "ㅑ",
  "ㅒ",
  "ㅓ",
  "ㅔ",
  "ㅕ",
  "ㅖ",
  "ㅗ",
  "ㅘ",
  "ㅙ",
  "ㅚ",
  "ㅛ",
  "ㅜ",
  "ㅝ",
  "ㅞ",
  "ㅟ",
  "ㅠ",
  "ㅡ",
  "ㅢ",
  "ㅣ",
] as const;

const FINAL_INDEX = new Map<string, number>([
  ["ㄱ", 1], ["ㄲ", 2], ["ㄳ", 3], ["ㄴ", 4], ["ㄵ", 5], ["ㄶ", 6],
  ["ㄷ", 7], ["ㄹ", 8], ["ㄺ", 9], ["ㄻ", 10], ["ㄼ", 11], ["ㄽ", 12],
  ["ㄾ", 13], ["ㄿ", 14], ["ㅀ", 15], ["ㅁ", 16], ["ㅂ", 17], ["ㅄ", 18],
  ["ㅅ", 19], ["ㅆ", 20], ["ㅇ", 21], ["ㅈ", 22], ["ㅊ", 23], ["ㅋ", 24],
  ["ㅌ", 25], ["ㅍ", 26], ["ㅎ", 27],
  ["ᆨ", 1], ["ᆩ", 2], ["ᆪ", 3], ["ᆫ", 4], ["ᆬ", 5], ["ᆭ", 6],
  ["ᆮ", 7], ["ᆯ", 8], ["ᆰ", 9], ["ᆱ", 10], ["ᆲ", 11], ["ᆳ", 12],
  ["ᆴ", 13], ["ᆵ", 14], ["ᆶ", 15], ["ᆷ", 16], ["ᆸ", 17], ["ᆹ", 18],
  ["ᆺ", 19], ["ᆻ", 20], ["ᆼ", 21], ["ᆽ", 22], ["ᆾ", 23], ["ᆿ", 24],
  ["ᇀ", 25], ["ᇁ", 26], ["ᇂ", 27],
]);

function collapsed(selection: SelectionSnapshot): boolean {
  return selection.from === selection.to;
}

function sameSelection(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  return a.from === b.from && a.to === b.to;
}

function sameRange(a: TextRange | undefined, b: TextRange): boolean {
  return a !== undefined && a.from === b.from && a.to === b.to;
}

function oneCodePoint(text: string): boolean {
  return Array.from(text).length === 1;
}

export function isHangulText(text: string): boolean {
  return text.length > 0 && /^[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7a3\ud7b0-\ud7ff]+$/u.test(text);
}

export function isHangulInputKey(key: string): boolean {
  return oneCodePoint(key) && isHangulText(key);
}

function syllableParts(character: string): { lead: number; vowel: number; final: number } | undefined {
  const code = character.codePointAt(0);
  if (code === undefined || code < 0xac00 || code > 0xd7a3) return undefined;
  const offset = code - 0xac00;
  return {
    lead: Math.floor(offset / 588),
    vowel: Math.floor((offset % 588) / 28),
    final: offset % 28,
  };
}

function compatibilityPart(character: string): { lead?: number; vowel?: number } {
  const lead = COMPAT_LEADS.indexOf(character as (typeof COMPAT_LEADS)[number]);
  if (lead >= 0) return { lead };
  const vowel = COMPAT_VOWELS.indexOf(character as (typeof COMPAT_VOWELS)[number]);
  return vowel >= 0 ? { vowel } : {};
}

/**
 * Checks that a delete/insert pair is a plausible continuation of the exact
 * Hangul text that was just removed. This is evidence only; it never attempts
 * to implement a physical keyboard layout.
 */
export function isConnectedHangulRewrite(previous: string, inserted: string): boolean {
  if (!isHangulText(previous) || !isHangulText(inserted)) return false;
  const oldCharacter = Array.from(previous).at(-1);
  if (!oldCharacter) return false;
  const oldSyllable = syllableParts(oldCharacter);
  const oldCompatibility = compatibilityPart(oldCharacter);

  return Array.from(inserted).some((character) => {
    if (character === oldCharacter) return true;
    const next = syllableParts(character);
    if (!next) return false;
    if (oldSyllable) {
      return next.lead === oldSyllable.lead && next.vowel === oldSyllable.vowel;
    }
    return oldCompatibility.lead === next.lead || oldCompatibility.vowel === next.vowel;
  });
}

function attachFinalConsonant(staleText: string, key: string): string | undefined {
  if (!oneCodePoint(staleText) || !oneCodePoint(key)) return undefined;
  const parts = syllableParts(staleText);
  const final = FINAL_INDEX.get(key);
  if (!parts || parts.final !== 0 || final === undefined) return undefined;
  return String.fromCodePoint(0xac00 + parts.lead * 588 + parts.vowel * 28 + final);
}

function recent(signalAt: number, eventAt: number | undefined, windowMs: number): boolean {
  return eventAt !== undefined && signalAt >= eventAt && signalAt - eventAt <= windowMs;
}

function inputTypeEvent(userEvent: string | undefined): boolean {
  return userEvent === "input.type";
}

function naturalBoundaryKey(key: string): boolean {
  return [" ", "Spacebar", "Enter", "Tab", "Escape", "Backspace", "Delete"].includes(key);
}

function languageSwitchKey(key: string): boolean {
  return ["HangulMode", "HanjaMode", "Lang1", "Lang2", "ModeChange", "CapsLock"].includes(key);
}

/**
 * Tracks iOS Korean's composition-less deleteBackward/insertText rewrites.
 * It only becomes reset/repair eligible after two consecutive rewrites of the
 * exact active tail. Once a stale destructive delete is proven, the original
 * document character is preserved and an underivable stale insertion falls
 * back only to the trusted single Korean key that initiated the pair.
 */
export class KoreanPseudoCompositionStateMachine {
  private active = false;
  private lastRange: TextRange | undefined;
  private lastText = "";
  private lastRewriteTime = 0;
  private rewriteCount = 0;
  private beforeInput: BeforeInputSignal | undefined;
  private keydown: KeySignal | undefined;
  private pendingDelete: PendingDelete | undefined;
  private pendingStaleDelete: PendingStaleDelete | undefined;
  private moved: MovedPseudoComposition | undefined;

  onRealCompositionEvent(): void {
    this.clear();
  }

  onExternalFocusBoundary(): void {
    this.clear();
  }

  /**
   * A plugin-initiated blur/focus is only a reset candidate. Stop using the
   * old tail to arm new guards, but retain an already moved guard until the
   * first post-reset input proves whether native state was actually cleared.
   */
  onResetSuccessCandidate(): void {
    this.active = false;
    this.lastRange = undefined;
    this.lastText = "";
    this.lastRewriteTime = 0;
    this.rewriteCount = 0;
    this.pendingDelete = undefined;
    this.pendingStaleDelete = undefined;
  }

  onKeyDown(signal: KeySignal): void {
    this.keydown = signal;
    if (signal.isComposing) return;
    if (signal.altKey || signal.ctrlKey || signal.metaKey) {
      this.clear();
      this.keydown = signal;
      return;
    }
    if (naturalBoundaryKey(signal.key) || languageSwitchKey(signal.key)) {
      this.clear();
      this.keydown = signal;
      return;
    }
    if (signal.key.length === 1 && !isHangulInputKey(signal.key)) {
      this.clear();
      this.keydown = signal;
    }
  }

  onBeforeInput(signal: BeforeInputSignal): void {
    this.beforeInput = signal;
    if (signal.isComposing) {
      this.clear();
      this.beforeInput = signal;
      return;
    }
    if (
      signal.inputType === "insertParagraph" ||
      signal.inputType === "insertLineBreak" ||
      (signal.inputType === "insertText" && signal.data !== null && !isHangulText(signal.data))
    ) {
      this.clear();
      this.beforeInput = signal;
    }
  }

  onSelectionMove(signal: SelectionMoveSignal): boolean {
    if (
      signal.origin === "other" ||
      sameSelection(signal.before, signal.after) ||
      !collapsed(signal.after)
    ) {
      if (!collapsed(signal.after)) this.clear();
      return false;
    }

    if (
      this.moved &&
      sameSelection(signal.before, this.moved.destination)
    ) {
      this.moved.destination = signal.after;
      this.moved.intended = undefined;
      this.pendingStaleDelete = undefined;
      return true;
    }

    if (
      !this.active ||
      this.rewriteCount < PSEUDO_MIN_REWRITES ||
      !this.lastRange ||
      !collapsed(signal.before) ||
      signal.before.to !== this.lastRange.to ||
      signal.after.to === this.lastRange.to ||
      !signal.textBeforeCursor.endsWith(this.lastText)
    ) {
      this.moved = undefined;
      return false;
    }

    this.moved = {
      sourceRange: { ...this.lastRange },
      sourceText: this.lastText,
      destination: signal.after,
    };
    this.pendingDelete = undefined;
    this.pendingStaleDelete = undefined;
    return true;
  }

  evaluate(signal: PseudoTransactionSignal): PseudoDecision {
    if (signal.changeCount !== 1) {
      this.pendingDelete = undefined;
      this.pendingStaleDelete = undefined;
      return { kind: "allow" };
    }

    if (signal.insert === "" && signal.from < signal.to) {
      return this.evaluateDelete(signal);
    }
    if (signal.from === signal.to && signal.insert !== "") {
      return this.evaluateInsert(signal);
    }

    this.pendingDelete = undefined;
    this.pendingStaleDelete = undefined;
    return { kind: "allow" };
  }

  onDocumentTransaction(
    userEvent: string | undefined,
    docChanged: boolean,
    preserveMovedGuard = false,
  ): void {
    if (!docChanged) return;
    if (this.moved && !preserveMovedGuard) {
      this.clear();
      return;
    }
    if (userEvent === "undo" || userEvent === "redo" || !userEvent?.startsWith("input.type")) {
      this.clear();
    }
  }

  commitAtomicRepair(decision: AtomicRepairDecision): void {
    const moved = this.moved;
    if (!moved) return;
    const replacedLength = decision.replace.to - decision.replace.from;
    const delta = decision.insert.length - replacedLength;
    if (decision.replace.to <= moved.sourceRange.from) {
      moved.sourceRange = {
        from: moved.sourceRange.from + delta,
        to: moved.sourceRange.to + delta,
      };
    } else if (decision.replace.from < moved.sourceRange.to) {
      this.clear();
      return;
    }
    moved.intended = {
      range: { from: decision.replace.from, to: decision.replace.from + decision.insert.length },
      text: decision.insert,
    };
    moved.destination = {
      from: moved.intended.range.to,
      to: moved.intended.range.to,
    };
    this.pendingStaleDelete = undefined;
  }

  getSourceGuard(): { range: TextRange; text: string } | undefined {
    return this.moved
      ? { range: { ...this.moved.sourceRange }, text: this.moved.sourceText }
      : undefined;
  }

  getDebugSnapshot(): PseudoDebugSnapshot {
    return {
      pseudoComposition: {
        active: this.active,
        lastRange: this.lastRange ? { ...this.lastRange } : null,
        lastText: this.lastText,
        lastRewriteTime: this.lastRewriteTime || null,
        rewriteCount: this.rewriteCount,
      },
      selectionMovedOutsidePseudoRange: this.moved !== undefined,
    };
  }

  private evaluateDelete(signal: PseudoTransactionSignal): PseudoDecision {
    const beforeInput = this.beforeInput;
    const keydown = this.keydown;
    const recentDeleteBeforeInput =
      beforeInput?.inputType === "deleteContentBackward" &&
      recent(signal.at, beforeInput.at, PSEUDO_INPUT_ASSOCIATION_MS);
    const recentKoreanKey =
      keydown !== undefined &&
      isHangulInputKey(keydown.key) &&
      !keydown.isComposing &&
      !keydown.altKey &&
      !keydown.ctrlKey &&
      !keydown.metaKey &&
      recent(signal.at, keydown.at, PSEUDO_INPUT_ASSOCIATION_MS);

    if (this.moved) {
      const expectedRange = this.moved.intended?.range;
      const atDestination = sameSelection(signal.selectionBefore, this.moved.destination);
      const exactContinuationDelete = expectedRange
        ? sameRange(expectedRange, { from: signal.from, to: signal.to }) &&
          signal.deletedText === this.moved.intended?.text
        : signal.to === signal.selectionBefore.to &&
          signal.from < signal.to &&
          oneCodePoint(signal.deletedText) &&
          !sameRange(this.moved.sourceRange, { from: signal.from, to: signal.to });

      if (
        recentDeleteBeforeInput &&
        recentKoreanKey &&
        inputTypeEvent(signal.userEvent) &&
        atDestination &&
        exactContinuationDelete &&
        signal.sourceStillPresent &&
        !signal.deletedText.includes("\n")
      ) {
        this.pendingStaleDelete = {
          at: signal.at,
          originalText: signal.deletedText,
          range: { from: signal.from, to: signal.to },
          intendedKey: keydown.key,
        };
        return {
          kind: "suppress-stale-delete",
          originalText: signal.deletedText,
          range: { from: signal.from, to: signal.to },
          staleText: this.moved.sourceText,
        };
      }

      return { kind: "allow" };
    }

    if (
      recentDeleteBeforeInput &&
      recentKoreanKey &&
      inputTypeEvent(signal.userEvent) &&
      sameRange(this.lastRange, { from: signal.from, to: signal.to }) &&
      signal.deletedText === this.lastText &&
      sameSelection(signal.selectionBefore, { from: signal.to, to: signal.to })
    ) {
      this.pendingDelete = {
        at: signal.at,
        range: { from: signal.from, to: signal.to },
        text: signal.deletedText,
      };
    } else {
      this.pendingDelete = undefined;
    }
    return { kind: "allow" };
  }

  private evaluateInsert(signal: PseudoTransactionSignal): PseudoDecision {
    const beforeInput = this.beforeInput;
    const recentInsertBeforeInput =
      beforeInput?.inputType === "insertText" &&
      beforeInput.data === signal.insert &&
      recent(signal.at, beforeInput.at, PSEUDO_INPUT_ASSOCIATION_MS);

    if (this.pendingStaleDelete && this.moved) {
      const pending = this.pendingStaleDelete;
      const pairIsImmediate = signal.at - pending.at <= PSEUDO_REWRITE_PAIR_MS;
      const isStaleCandidate =
        pairIsImmediate &&
        recentInsertBeforeInput &&
        inputTypeEvent(signal.userEvent) &&
        isHangulText(signal.insert);

      if (!isStaleCandidate) {
        this.pendingStaleDelete = undefined;
        return { kind: "allow" };
      }

      const intended = this.deriveIntendedText(
        this.moved.sourceText,
        pending.intendedKey,
        signal.insert,
      );
      const replace = this.moved.intended?.range ?? {
        from: this.moved.destination.from,
        to: this.moved.destination.to,
      };
      this.pendingStaleDelete = undefined;
      return {
        kind: "atomic-repair",
        insert: intended ?? pending.intendedKey,
        replace,
        staleText: this.moved.sourceText,
        originalText: pending.originalText,
        source: intended ? "derived" : "pending-intended-key",
      };
    }

    const pending = this.pendingDelete;
    if (
      pending &&
      signal.at - pending.at <= PSEUDO_REWRITE_PAIR_MS &&
      recentInsertBeforeInput &&
      inputTypeEvent(signal.userEvent) &&
      signal.from === pending.range.from &&
      isConnectedHangulRewrite(pending.text, signal.insert)
    ) {
      const previousWasTracked =
        this.lastRange !== undefined &&
        sameRange(this.lastRange, pending.range) &&
        this.lastText === pending.text;
      const tail = Array.from(signal.insert).at(-1) ?? "";
      const tailLength = tail.length;
      this.active = true;
      this.lastRange = {
        from: signal.from + signal.insert.length - tailLength,
        to: signal.from + signal.insert.length,
      };
      this.lastText = tail;
      this.lastRewriteTime = signal.at;
      this.rewriteCount = previousWasTracked ? this.rewriteCount + 1 : 1;
      this.pendingDelete = undefined;
      return { kind: "allow" };
    }

    this.pendingDelete = undefined;
    if (recentInsertBeforeInput && inputTypeEvent(signal.userEvent) && isHangulText(signal.insert)) {
      if (this.moved) this.clear();
      const tail = Array.from(signal.insert).at(-1) ?? "";
      this.active = true;
      this.lastRange = {
        from: signal.from + signal.insert.length - tail.length,
        to: signal.from + signal.insert.length,
      };
      this.lastText = tail;
      this.lastRewriteTime = signal.at;
      this.rewriteCount = 0;
    }
    return { kind: "allow" };
  }

  private deriveIntendedText(staleText: string, key: string, inserted: string): string | undefined {
    if (!isHangulInputKey(key)) return undefined;
    if (inserted.startsWith(staleText)) {
      const suffix = inserted.slice(staleText.length);
      return isHangulText(suffix) ? suffix : undefined;
    }
    return attachFinalConsonant(staleText, key) === inserted ? key : undefined;
  }

  private clear(): void {
    this.active = false;
    this.lastRange = undefined;
    this.lastText = "";
    this.lastRewriteTime = 0;
    this.rewriteCount = 0;
    this.pendingDelete = undefined;
    this.pendingStaleDelete = undefined;
    this.moved = undefined;
  }
}
