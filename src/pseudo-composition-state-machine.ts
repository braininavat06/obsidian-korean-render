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
  docChanged: boolean;
  userEvent: string | undefined;
  selectionBefore: SelectionSnapshot;
  selectionAfter: SelectionSnapshot;
  sourceStillPresent: boolean;
}

export interface AppliedTransactionSignal {
  at: number;
  userEvent: string | undefined;
  docChanged: boolean;
  changeCount: number;
  from: number;
  to: number;
  insert: string;
  selectionBefore: SelectionSnapshot;
  selectionAfter: SelectionSnapshot;
}

export type PseudoDecision =
  | { kind: "allow" }
  | {
      kind: "suppress-stale-delete";
      originalText: string;
      range: TextRange;
      repairRange: TextRange;
      staleText: string;
      deleteSource: "exact-continuation" | "shifted-native-tail" | "protected-document" | "backspace-rewind-spill";
    }
  | {
      kind: "atomic-repair";
      insert: string;
      replace: TextRange;
      staleText: string;
      originalText: string;
      source: "derived" | "native-rewrite" | "pending-intended-key";
      nativeTailText: string;
    }
  | {
      kind: "suppress-stale-replay";
      insert: string;
      destination: SelectionSnapshot;
      armedAt: number;
      armReason: string;
    }

export type AtomicRepairDecision = Extract<PseudoDecision, { kind: "atomic-repair" }>;

export interface PseudoDebugSnapshot {
  pseudoComposition: {
    active: boolean;
    lastRange: TextRange | null;
    lastText: string;
    lastRewriteTime: number | null;
    rewriteCount: number;
    guardConfidence: GuardConfidence | null;
    singleRewriteLineage: SingleRewriteLineageSnapshot | null;
  };
  nativeBackspaceRewind: {
    phase: NativeBackspacePhase;
    keyAt: number;
    mutableRange: TextRange;
    mutableText: string;
  } | null;
  selectionMovedOutsidePseudoRange: boolean;
  movedGuard: {
    protectedSourceRange: TextRange;
    protectedSourceText: string;
    nativeTailRange: TextRange;
    nativeTailText: string;
    destination: SelectionSnapshot;
    intendedRange: TextRange | null;
    intendedText: string;
    guardConfidence: GuardConfidence;
    singleRewriteLineage: SingleRewriteLineageSnapshot | null;
  } | null;
  pendingPostDeleteReplayGuard: {
    armedAt: number;
    expiresAt: number;
    destination: SelectionSnapshot;
    deletedRange: TextRange;
    armReason: string;
  } | null;
}

interface PendingDelete {
  at: number;
  range: TextRange;
  text: string;
  initialFragment?: InitialFragmentCandidate;
  trigger?: "korean-key" | "backspace-rewind";
}

type GuardConfidence = "multi-rewrite" | "single-confirmed-lineage";

interface InitialFragmentCandidate {
  insertedAt: number;
  range: TextRange;
  text: string;
  key: string;
}

interface SingleRewriteLineageSnapshot {
  initialText: string;
  initialRange: TextRange;
  deletedText: string;
  deletedRange: TextRange;
  replacementText: string;
  replacementRange: TextRange;
  rewriteIntervalMs: number;
  deleteInsertIntervalMs: number;
}

interface PendingStaleDelete {
  at: number;
  originalText: string;
  attemptedRange: TextRange;
  repairRange: TextRange;
  intendedKey: string;
  deleteSource: "exact-continuation" | "shifted-native-tail" | "protected-document";
  initialFragment?: InitialFragmentCandidate;
}

type NativeBackspacePhase = "armed" | "delete-accepted" | "rewrite-completed" | "spill-suppressed";

interface NativeBackspaceRewind {
  keyAt: number;
  selection: SelectionSnapshot;
  mutableRange: TextRange;
  mutableText: string;
  phase: NativeBackspacePhase;
  spillAt?: number;
}

type PendingAtomicHandoff =
  | { kind: "seed"; insertedAt: number; key: string }
  | {
      kind: "confirm";
      candidate: InitialFragmentCandidate;
      deletedRange: TextRange;
      deletedText: string;
      deletedAt: number;
      replacementAt: number;
    };

interface MovedPseudoComposition {
  protectedSourceRange: TextRange;
  protectedSourceText: string;
  nativeTailRange: TextRange;
  nativeTailText: string;
  destination: SelectionSnapshot;
  intended?: { range: TextRange; text: string };
  guardConfidence: GuardConfidence;
  singleRewriteLineage?: SingleRewriteLineageSnapshot;
}

interface PendingSelectionDeleteKey {
  at: number;
  key: "Backspace" | "Delete";
  selection: SelectionSnapshot;
}

interface PendingPostDeleteReplayGuard {
  armedAt: number;
  expiresAt: number;
  destination: SelectionSnapshot;
  deletedRange: TextRange;
  armReason: string;
}

export interface PseudoDiagnostic {
  eventType:
    | "post-delete-replay-guard-armed"
    | "post-delete-noop-preserved"
    | "post-delete-guard-disarmed"
    | "single-rewrite-lineage-confirmed";
  details: Record<string, unknown>;
}

export const PSEUDO_REWRITE_PAIR_MS = 80;
export const PSEUDO_INPUT_ASSOCIATION_MS = 160;
export const PSEUDO_MIN_REWRITES = 2;
export const POST_DELETE_REPLAY_GUARD_MS = 40;

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

function cursorAt(position: number): SelectionSnapshot {
  return { from: position, to: position };
}

function sameRange(a: TextRange | undefined, b: TextRange): boolean {
  return a !== undefined && a.from === b.from && a.to === b.to;
}

function oneCodePoint(text: string): boolean {
  return Array.from(text).length === 1;
}

function isCompatibilityLead(text: string): boolean {
  return oneCodePoint(text) && COMPAT_LEADS.includes(text as (typeof COMPAT_LEADS)[number]);
}

function copyLineage(lineage: SingleRewriteLineageSnapshot): SingleRewriteLineageSnapshot {
  return {
    ...lineage,
    initialRange: { ...lineage.initialRange },
    deletedRange: { ...lineage.deletedRange },
    replacementRange: { ...lineage.replacementRange },
  };
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

function syllableWithoutFinal(text: string): string | undefined {
  if (!oneCodePoint(text)) return undefined;
  const parts = syllableParts(text);
  if (!parts || parts.final === 0) return undefined;
  return String.fromCodePoint(0xac00 + parts.lead * 588 + parts.vowel * 28);
}

function nativeCarrySuffix(nativeTail: string, inserted: string): string | undefined {
  if (inserted.startsWith(nativeTail)) {
    const suffix = inserted.slice(nativeTail.length);
    return isHangulText(suffix) ? suffix : undefined;
  }
  const withoutFinal = syllableWithoutFinal(nativeTail);
  if (!withoutFinal || !inserted.startsWith(withoutFinal)) return undefined;
  const suffix = inserted.slice(withoutFinal.length);
  return isHangulText(suffix) ? suffix : undefined;
}

function nativeResultConsumesPendingSequence(
  pendingText: string,
  key: string,
  inserted: string,
): boolean {
  if (!oneCodePoint(inserted)) return false;
  const sequence = [...Array.from(pendingText), key];
  if (sequence.length < 2 || sequence.length > 3) return false;
  const lead = COMPAT_LEADS.indexOf(sequence[0] as (typeof COMPAT_LEADS)[number]);
  const vowel = COMPAT_VOWELS.indexOf(sequence[1] as (typeof COMPAT_VOWELS)[number]);
  if (lead < 0 || vowel < 0) return false;
  const final = sequence.length === 3 ? FINAL_INDEX.get(sequence[2] ?? "") : 0;
  if (final === undefined) return false;
  const insertedParts = syllableParts(inserted);
  return (
    insertedParts !== undefined &&
    insertedParts.lead === lead &&
    insertedParts.vowel === vowel &&
    insertedParts.final === final
  );
}

function isDirectHangulRewrite(previous: string, inserted: string): boolean {
  const first = Array.from(inserted)[0];
  return first !== undefined && isConnectedHangulRewrite(previous, first);
}

function recent(signalAt: number, eventAt: number | undefined, windowMs: number): boolean {
  return eventAt !== undefined && signalAt >= eventAt && signalAt - eventAt <= windowMs;
}

function inputTypeEvent(userEvent: string | undefined): boolean {
  return userEvent === "input.type";
}

function naturalBoundaryKey(key: string): boolean {
  return [" ", "Spacebar", "Enter", "Tab", "Escape", "Delete"].includes(key);
}

function languageSwitchKey(key: string): boolean {
  return ["HangulMode", "HanjaMode", "Lang1", "Lang2", "ModeChange", "CapsLock"].includes(key);
}

/**
 * Tracks iOS Korean's composition-less deleteBackward/insertText rewrites.
 * It normally becomes repair eligible after two consecutive rewrites of the
 * exact active tail. A single rewrite qualifies only when an actual Korean
 * key/initial-fragment insertion, its exact deletion, and its same-range
 * native syllable replacement form one confirmed lineage. Once a stale
 * destructive delete is proven, the original document character is preserved.
 */
export class KoreanPseudoCompositionStateMachine {
  private active = false;
  private lastRange: TextRange | undefined;
  private lastText = "";
  private lastRewriteTime = 0;
  private rewriteCount = 0;
  private beforeInput: BeforeInputSignal | undefined;
  private keydown: KeySignal | undefined;
  private keydownSelection: SelectionSnapshot | undefined;
  private pendingDelete: PendingDelete | undefined;
  private pendingStaleDelete: PendingStaleDelete | undefined;
  private moved: MovedPseudoComposition | undefined;
  private initialFragmentCandidate: InitialFragmentCandidate | undefined;
  private singleRewriteLineage: SingleRewriteLineageSnapshot | undefined;
  private pendingSelectionDeleteKey: PendingSelectionDeleteKey | undefined;
  private pendingPostDeleteReplayGuard: PendingPostDeleteReplayGuard | undefined;
  private pendingAtomicHandoff: PendingAtomicHandoff | undefined;
  private nativeBackspaceRewind: NativeBackspaceRewind | undefined;
  private preserveNextMovedDocumentTransaction = false;
  private readonly diagnostics: PseudoDiagnostic[] = [];

  onRealCompositionEvent(): void {
    this.disarmPostDeleteReplayGuard("composition-event");
    this.pendingSelectionDeleteKey = undefined;
    this.clearCompositionState();
  }

  onExternalFocusBoundary(): void {
    this.disarmPostDeleteReplayGuard("external-blur");
    this.pendingSelectionDeleteKey = undefined;
    this.clearCompositionState();
  }

  onKeyDown(signal: KeySignal, selection?: SelectionSnapshot): void {
    this.expirePostDeleteReplayGuard(signal.at);
    if (this.pendingPostDeleteReplayGuard) {
      this.disarmPostDeleteReplayGuard(
        isHangulInputKey(signal.key) ? "korean-keydown" : `keydown:${signal.key}`,
      );
    }
    if (
      !signal.isComposing &&
      !signal.altKey &&
      !signal.ctrlKey &&
      !signal.metaKey &&
      (signal.key === "Backspace" || signal.key === "Delete") &&
      selection &&
      !collapsed(selection)
    ) {
      this.pendingSelectionDeleteKey = {
        at: signal.at,
        key: signal.key,
        selection: { ...selection },
      };
    } else {
      this.pendingSelectionDeleteKey = undefined;
    }
    this.keydown = signal;
    this.keydownSelection = selection ? { ...selection } : undefined;
    if (signal.isComposing) return;
    if (signal.altKey || signal.ctrlKey || signal.metaKey) {
      this.clearCompositionState();
      this.keydown = signal;
      return;
    }
    if (signal.key === "Backspace") {
      const mutable = selection && collapsed(selection) ? this.currentMutableTail() : undefined;
      if (
        mutable &&
        selection &&
        sameSelection(selection, cursorAt(mutable.range.to))
      ) {
        this.nativeBackspaceRewind = {
          keyAt: signal.at,
          selection: { ...selection },
          mutableRange: { ...mutable.range },
          mutableText: mutable.text,
          phase: "armed",
        };
        this.pendingDelete = undefined;
        this.pendingStaleDelete = undefined;
        return;
      }
      this.clearCompositionState();
      this.keydown = signal;
      return;
    }
    if (naturalBoundaryKey(signal.key) || languageSwitchKey(signal.key)) {
      this.clearCompositionState();
      this.keydown = signal;
      return;
    }
    this.nativeBackspaceRewind = undefined;
    if (signal.key.length === 1 && !isHangulInputKey(signal.key)) {
      this.clearCompositionState();
      this.keydown = signal;
    }
  }

  onBeforeInput(signal: BeforeInputSignal): void {
    this.expirePostDeleteReplayGuard(signal.at);
    this.beforeInput = signal;
    if (signal.isComposing) {
      this.pendingSelectionDeleteKey = undefined;
      this.disarmPostDeleteReplayGuard("composing-beforeinput");
      this.clearCompositionState();
      this.beforeInput = signal;
      return;
    }
    if (signal.inputType === "insertFromPaste" || signal.inputType === "insertFromDrop") {
      this.pendingSelectionDeleteKey = undefined;
      this.disarmPostDeleteReplayGuard(signal.inputType);
      this.clearCompositionState();
      this.beforeInput = signal;
      return;
    }
    if (
      signal.inputType === "insertParagraph" ||
      signal.inputType === "insertLineBreak" ||
      (signal.inputType === "insertText" && signal.data !== null && !isHangulText(signal.data))
    ) {
      this.pendingSelectionDeleteKey = undefined;
      this.disarmPostDeleteReplayGuard(`beforeinput:${signal.inputType}`);
      this.clearCompositionState();
      this.beforeInput = signal;
    }
  }

  onSelectionMove(signal: SelectionMoveSignal): boolean {
    this.expirePostDeleteReplayGuard(signal.at);
    this.pendingSelectionDeleteKey = undefined;
    this.nativeBackspaceRewind = undefined;
    this.disarmPostDeleteReplayGuard("selection-change");
    if (
      signal.origin === "other" ||
      sameSelection(signal.before, signal.after) ||
      !collapsed(signal.after)
    ) {
      if (!collapsed(signal.after)) this.clearCompositionState();
      else if (!sameSelection(signal.before, signal.after)) this.clearSingleRewriteEvidence();
      return false;
    }

    if (
      this.moved &&
      sameSelection(signal.before, this.moved.destination)
    ) {
      const confirmedHandoff =
        this.active &&
        this.rewriteCount === 1 &&
        this.singleRewriteLineage !== undefined &&
        this.lastRange !== undefined &&
        sameRange(this.lastRange, this.singleRewriteLineage.replacementRange) &&
        this.lastText === this.singleRewriteLineage.replacementText &&
        signal.before.to === this.lastRange.to &&
        signal.textBeforeCursor.endsWith(this.lastText);
      if (confirmedHandoff && this.lastRange && this.singleRewriteLineage) {
        this.moved = {
          protectedSourceRange: { ...this.lastRange },
          protectedSourceText: this.lastText,
          nativeTailRange: { ...this.lastRange },
          nativeTailText: this.lastText,
          destination: signal.after,
          guardConfidence: "single-confirmed-lineage",
          singleRewriteLineage: copyLineage(this.singleRewriteLineage),
        };
        this.initialFragmentCandidate = undefined;
        this.pendingDelete = undefined;
        this.pendingStaleDelete = undefined;
        return true;
      }
      this.moved.destination = signal.after;
      this.moved.intended = undefined;
      this.pendingStaleDelete = undefined;
      return true;
    }

    const singleRewriteEligible =
      this.rewriteCount === 1 &&
      this.singleRewriteLineage !== undefined &&
      this.lastRange !== undefined &&
      sameRange(this.lastRange, this.singleRewriteLineage.replacementRange) &&
      this.lastText === this.singleRewriteLineage.replacementText;
    const guardConfidence: GuardConfidence | undefined =
      this.rewriteCount >= PSEUDO_MIN_REWRITES
        ? "multi-rewrite"
        : singleRewriteEligible
          ? "single-confirmed-lineage"
          : undefined;

    if (
      !this.active ||
      guardConfidence === undefined ||
      !this.lastRange ||
      !collapsed(signal.before) ||
      signal.before.to !== this.lastRange.to ||
      signal.after.to === this.lastRange.to ||
      !signal.textBeforeCursor.endsWith(this.lastText)
    ) {
      this.moved = undefined;
      this.clearSingleRewriteEvidence();
      return false;
    }

    this.moved = {
      protectedSourceRange: { ...this.lastRange },
      protectedSourceText: this.lastText,
      nativeTailRange: { ...this.lastRange },
      nativeTailText: this.lastText,
      destination: signal.after,
      guardConfidence,
      singleRewriteLineage:
        guardConfidence === "single-confirmed-lineage" && this.singleRewriteLineage
          ? copyLineage(this.singleRewriteLineage)
          : undefined,
    };
    this.initialFragmentCandidate = undefined;
    this.pendingDelete = undefined;
    this.pendingStaleDelete = undefined;
    return true;
  }

  evaluate(signal: PseudoTransactionSignal): PseudoDecision {
    this.expirePostDeleteReplayGuard(signal.at);
    if (signal.changeCount === 0) {
      const guard = this.pendingPostDeleteReplayGuard;
      const sameDeleteBurst =
        guard !== undefined &&
        !signal.docChanged &&
        signal.insert === "" &&
        this.beforeInput?.inputType === "deleteContentBackward" &&
        recent(signal.at, this.beforeInput.at, PSEUDO_INPUT_ASSOCIATION_MS) &&
        sameSelection(signal.selectionBefore, guard.destination) &&
        sameSelection(signal.selectionAfter, guard.destination);
      if (sameDeleteBurst) {
        this.diagnostics.push({
          eventType: "post-delete-noop-preserved",
          details: {
            reason: "same-deleteContentBackward-burst",
            armedAt: guard.armedAt,
            destination: { ...guard.destination },
          },
        });
      } else if (guard) {
        this.disarmPostDeleteReplayGuard(
          !sameSelection(signal.selectionBefore, signal.selectionAfter) ||
            !sameSelection(signal.selectionAfter, guard.destination)
            ? "zero-change-selection-change"
            : "unrelated-zero-change-transaction",
        );
      }
      this.pendingDelete = undefined;
      this.pendingStaleDelete = undefined;
      return { kind: "allow" };
    }
    if (signal.changeCount > 1) {
      this.disarmPostDeleteReplayGuard("multi-change-document-transaction");
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
    this.disarmPostDeleteReplayGuard("non-matching-input-transaction");
    return { kind: "allow" };
  }

  onDocumentTransaction(
    userEvent: string | undefined,
    docChanged: boolean,
    preserveMovedGuard = false,
  ): void {
    if (!docChanged) return;
    const preserveLifecycle = this.preserveNextMovedDocumentTransaction;
    this.preserveNextMovedDocumentTransaction = false;
    this.disarmPostDeleteReplayGuard(
      userEvent === "undo" || userEvent === "redo"
        ? userEvent
        : "other-document-transaction",
    );
    if (this.moved && !preserveMovedGuard && !preserveLifecycle) {
      this.clearCompositionState();
      return;
    }
    if (userEvent === "undo" || userEvent === "redo" || !userEvent?.startsWith("input.type")) {
      this.clearCompositionState();
    }
  }

  onAppliedTransaction(signal: AppliedTransactionSignal): void {
    const rewind = this.nativeBackspaceRewind;
    if (
      rewind?.phase === "delete-accepted" &&
      signal.docChanged &&
      signal.changeCount === 1 &&
      signal.from === rewind.mutableRange.from &&
      signal.to === rewind.mutableRange.to &&
      signal.insert === ""
    ) {
      this.active = false;
      this.lastRange = undefined;
      this.lastText = "";
      this.lastRewriteTime = 0;
      this.rewriteCount = 0;
      this.moved = undefined;
      this.clearSingleRewriteEvidence();
    }
    const pending = this.pendingSelectionDeleteKey;
    this.pendingSelectionDeleteKey = undefined;
    if (
      !pending ||
      !signal.docChanged ||
      signal.userEvent !== "delete.selection" ||
      !recent(signal.at, pending.at, PSEUDO_INPUT_ASSOCIATION_MS) ||
      collapsed(pending.selection) ||
      !sameSelection(pending.selection, signal.selectionBefore) ||
      signal.changeCount !== 1 ||
      signal.from !== pending.selection.from ||
      signal.to !== pending.selection.to ||
      signal.insert !== "" ||
      !sameSelection(signal.selectionAfter, {
        from: pending.selection.from,
        to: pending.selection.from,
      })
    ) {
      return;
    }
    const armReason = `physical-${pending.key.toLowerCase()}-delete.selection`;
    this.pendingPostDeleteReplayGuard = {
      armedAt: signal.at,
      expiresAt: signal.at + POST_DELETE_REPLAY_GUARD_MS,
      destination: { ...signal.selectionAfter },
      deletedRange: { from: signal.from, to: signal.to },
      armReason,
    };
    this.diagnostics.push({
      eventType: "post-delete-replay-guard-armed",
      details: {
        reason: armReason,
        windowMs: POST_DELETE_REPLAY_GUARD_MS,
        destination: { ...signal.selectionAfter },
        deletedRange: { from: signal.from, to: signal.to },
      },
    });
  }

  drainDiagnostics(): PseudoDiagnostic[] {
    return this.diagnostics.splice(0);
  }

  commitAtomicRepair(decision: AtomicRepairDecision): void {
    const moved = this.moved;
    if (!moved) return;
    const handoff = this.pendingAtomicHandoff;
    this.pendingAtomicHandoff = undefined;
    const previousIntended = moved.intended;
    const replacedLength = decision.replace.to - decision.replace.from;
    const delta = decision.insert.length - replacedLength;
    if (decision.replace.to <= moved.protectedSourceRange.from) {
      moved.protectedSourceRange = {
        from: moved.protectedSourceRange.from + delta,
        to: moved.protectedSourceRange.to + delta,
      };
    } else if (decision.replace.from < moved.protectedSourceRange.to) {
      this.clearCompositionState();
      return;
    }
    if (
      previousIntended &&
      decision.replace.from >= previousIntended.range.from &&
      decision.replace.to <= previousIntended.range.to
    ) {
      const relativeFrom = decision.replace.from - previousIntended.range.from;
      const relativeTo = decision.replace.to - previousIntended.range.from;
      moved.intended = {
        range: {
          from: previousIntended.range.from,
          to: previousIntended.range.to + delta,
        },
        text:
          previousIntended.text.slice(0, relativeFrom) +
          decision.insert +
          previousIntended.text.slice(relativeTo),
      };
    } else {
      moved.intended = {
        range: { from: decision.replace.from, to: decision.replace.from + decision.insert.length },
        text: decision.insert,
      };
    }
    moved.destination = {
      from: moved.intended.range.to,
      to: moved.intended.range.to,
    };
    const nativeTail = Array.from(decision.nativeTailText).at(-1) ?? "";
    moved.nativeTailRange = {
      from: moved.intended.range.to - nativeTail.length,
      to: moved.intended.range.to,
    };
    moved.nativeTailText = nativeTail;
    this.pendingStaleDelete = undefined;

    if (
      handoff?.kind === "seed" &&
      decision.insert === handoff.key &&
      moved.intended.text.endsWith(handoff.key)
    ) {
      const range = {
        from: moved.intended.range.to - handoff.key.length,
        to: moved.intended.range.to,
      };
      this.active = true;
      this.lastRange = { ...range };
      this.lastText = handoff.key;
      this.lastRewriteTime = handoff.insertedAt;
      this.rewriteCount = 0;
      this.initialFragmentCandidate = {
        insertedAt: handoff.insertedAt,
        range: { ...range },
        text: handoff.key,
        key: handoff.key,
      };
      this.singleRewriteLineage = undefined;
      return;
    }

    if (
      handoff?.kind === "confirm" &&
      oneCodePoint(decision.insert) &&
      moved.intended.text === decision.insert
    ) {
      const replacementRange = { ...moved.intended.range };
      const lineage: SingleRewriteLineageSnapshot = {
        initialText: handoff.candidate.text,
        initialRange: { ...handoff.candidate.range },
        deletedText: handoff.deletedText,
        deletedRange: { ...handoff.deletedRange },
        replacementText: decision.insert,
        replacementRange,
        rewriteIntervalMs: handoff.replacementAt - handoff.candidate.insertedAt,
        deleteInsertIntervalMs: handoff.replacementAt - handoff.deletedAt,
      };
      this.active = true;
      this.lastRange = { ...replacementRange };
      this.lastText = decision.insert;
      this.lastRewriteTime = handoff.replacementAt;
      this.rewriteCount = 1;
      this.initialFragmentCandidate = undefined;
      this.singleRewriteLineage = lineage;
      this.diagnostics.push({
        eventType: "single-rewrite-lineage-confirmed",
        details: { ...copyLineage(lineage), lifecycle: "moved-repair-handoff" },
      });
      return;
    }

    this.active = false;
    this.lastRange = undefined;
    this.lastText = "";
    this.lastRewriteTime = 0;
    this.rewriteCount = 0;
    this.clearSingleRewriteEvidence();
  }

  getSourceGuard(): { range: TextRange; text: string } | undefined {
    return this.moved
      ? {
          range: { ...this.moved.protectedSourceRange },
          text: this.moved.protectedSourceText,
        }
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
        guardConfidence:
          this.rewriteCount >= PSEUDO_MIN_REWRITES
            ? "multi-rewrite"
            : this.singleRewriteLineage
              ? "single-confirmed-lineage"
              : null,
        singleRewriteLineage: this.singleRewriteLineage
          ? copyLineage(this.singleRewriteLineage)
          : null,
      },
      selectionMovedOutsidePseudoRange: this.moved !== undefined,
      movedGuard: this.moved
        ? {
            protectedSourceRange: { ...this.moved.protectedSourceRange },
            protectedSourceText: this.moved.protectedSourceText,
            nativeTailRange: { ...this.moved.nativeTailRange },
            nativeTailText: this.moved.nativeTailText,
            destination: { ...this.moved.destination },
            intendedRange: this.moved.intended ? { ...this.moved.intended.range } : null,
            intendedText: this.moved.intended?.text ?? "",
            guardConfidence: this.moved.guardConfidence,
            singleRewriteLineage: this.moved.singleRewriteLineage
              ? copyLineage(this.moved.singleRewriteLineage)
              : null,
          }
        : null,
      pendingPostDeleteReplayGuard: this.pendingPostDeleteReplayGuard
        ? {
            armedAt: this.pendingPostDeleteReplayGuard.armedAt,
            expiresAt: this.pendingPostDeleteReplayGuard.expiresAt,
            destination: { ...this.pendingPostDeleteReplayGuard.destination },
            deletedRange: { ...this.pendingPostDeleteReplayGuard.deletedRange },
            armReason: this.pendingPostDeleteReplayGuard.armReason,
          }
        : null,
      nativeBackspaceRewind: this.nativeBackspaceRewind
        ? {
            phase: this.nativeBackspaceRewind.phase,
            keyAt: this.nativeBackspaceRewind.keyAt,
            mutableRange: { ...this.nativeBackspaceRewind.mutableRange },
            mutableText: this.nativeBackspaceRewind.mutableText,
          }
        : null,
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

    const rewind = this.nativeBackspaceRewind;
    const recentPhysicalBackspace =
      rewind !== undefined &&
      keydown?.key === "Backspace" &&
      !keydown.isComposing &&
      !keydown.altKey &&
      !keydown.ctrlKey &&
      !keydown.metaKey &&
      recent(signal.at, rewind.keyAt, PSEUDO_INPUT_ASSOCIATION_MS);
    if (
      rewind &&
      recentPhysicalBackspace &&
      recentDeleteBeforeInput &&
      signal.docChanged &&
      signal.sourceStillPresent &&
      !signal.deletedText.includes("\n")
    ) {
      const exactMutableDelete =
        rewind.phase === "armed" &&
        sameRange(rewind.mutableRange, { from: signal.from, to: signal.to }) &&
        signal.deletedText === rewind.mutableText &&
        sameSelection(signal.selectionBefore, rewind.selection);
      if (exactMutableDelete) {
        rewind.phase = "delete-accepted";
        this.pendingDelete = {
          at: signal.at,
          range: { from: signal.from, to: signal.to },
          text: signal.deletedText,
          trigger: "backspace-rewind",
        };
        this.preserveNextMovedDocumentTransaction = true;
        return { kind: "allow" };
      }

      if (
        rewind.phase !== "armed" &&
        oneCodePoint(signal.deletedText) &&
        (signal.to === signal.selectionBefore.to || signal.from === signal.selectionBefore.to)
      ) {
        rewind.phase = "spill-suppressed";
        rewind.spillAt = signal.at;
        this.pendingDelete = undefined;
        return {
          kind: "suppress-stale-delete",
          originalText: signal.deletedText,
          range: { from: signal.from, to: signal.to },
          repairRange: { ...rewind.mutableRange },
          staleText: rewind.mutableText,
          deleteSource: "backspace-rewind-spill",
        };
      }
    }

    if (this.moved) {
      const intended = this.moved.intended;
      const atDestination = sameSelection(signal.selectionBefore, this.moved.destination);
      const exactContinuationDelete = intended
        ? signal.from >= intended.range.from &&
          signal.to === intended.range.to &&
          signal.from < signal.to &&
          signal.deletedText ===
            intended.text.slice(
              signal.from - intended.range.from,
              signal.to - intended.range.from,
            )
        : signal.to === signal.selectionBefore.to &&
          signal.from < signal.to &&
          oneCodePoint(signal.deletedText) &&
          !sameRange(this.moved.protectedSourceRange, { from: signal.from, to: signal.to });
      const nativeTailLength = this.moved.nativeTailText.length;
      const shiftedNativeTailDelete =
        intended !== undefined &&
        nativeTailLength > 0 &&
        sameSelection(this.moved.destination, cursorAt(intended.range.to)) &&
        sameSelection(signal.selectionBefore, cursorAt(intended.range.to)) &&
        this.keydownSelection !== undefined &&
        sameSelection(this.keydownSelection, this.moved.destination) &&
        this.moved.nativeTailRange.to === intended.range.to &&
        this.moved.nativeTailRange.from === intended.range.to - nativeTailLength &&
        intended.text.endsWith(this.moved.nativeTailText) &&
        signal.from === intended.range.to &&
        signal.to === intended.range.to + nativeTailLength &&
        signal.deletedText.length === nativeTailLength &&
        signal.deletedText === this.moved.nativeTailText &&
        signal.to <= this.moved.protectedSourceRange.from;
      const overlapsProtectedSource =
        signal.from < this.moved.protectedSourceRange.to &&
        signal.to > this.moved.protectedSourceRange.from;
      const protectedDocumentDelete =
        intended === undefined &&
        !exactContinuationDelete &&
        !shiftedNativeTailDelete &&
        oneCodePoint(signal.deletedText) &&
        this.keydownSelection !== undefined &&
        sameSelection(this.keydownSelection, this.moved.destination) &&
        (signal.to === this.moved.destination.to || signal.from === this.moved.destination.to) &&
        !overlapsProtectedSource;

      if (
        recentDeleteBeforeInput &&
        recentKoreanKey &&
        signal.docChanged &&
        inputTypeEvent(signal.userEvent) &&
        atDestination &&
        (exactContinuationDelete || shiftedNativeTailDelete || protectedDocumentDelete) &&
        signal.sourceStillPresent &&
        !signal.deletedText.includes("\n")
      ) {
        const deleteSource = shiftedNativeTailDelete
          ? "shifted-native-tail"
          : protectedDocumentDelete
            ? "protected-document"
            : "exact-continuation";
        const repairRange = shiftedNativeTailDelete
          ? { ...this.moved.nativeTailRange }
          : protectedDocumentDelete
            ? { ...this.moved.destination }
            : { from: signal.from, to: signal.to };
        if (shiftedNativeTailDelete) {
          this.moved.nativeTailRange = { from: signal.from, to: signal.to };
        }
        const candidate = this.initialFragmentCandidate;
        const exactInitialFragmentDelete =
          candidate !== undefined &&
          exactContinuationDelete &&
          sameRange(candidate.range, { from: signal.from, to: signal.to }) &&
          signal.deletedText === candidate.text &&
          recent(signal.at, candidate.insertedAt, PSEUDO_INPUT_ASSOCIATION_MS);
        this.pendingStaleDelete = {
          at: signal.at,
          originalText: signal.deletedText,
          attemptedRange: { from: signal.from, to: signal.to },
          repairRange,
          intendedKey: keydown.key,
          deleteSource,
          initialFragment: exactInitialFragmentDelete
            ? { ...candidate, range: { ...candidate.range } }
            : undefined,
        };
        return {
          kind: "suppress-stale-delete",
          originalText: signal.deletedText,
          range: { from: signal.from, to: signal.to },
          repairRange,
          staleText: this.moved.nativeTailText,
          deleteSource,
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
      const candidate = this.initialFragmentCandidate;
      const exactInitialFragmentDelete =
        candidate !== undefined &&
        signal.docChanged &&
        sameRange(candidate.range, { from: signal.from, to: signal.to }) &&
        signal.deletedText === candidate.text &&
        sameSelection(signal.selectionBefore, cursorAt(candidate.range.to)) &&
        this.keydownSelection !== undefined &&
        sameSelection(this.keydownSelection, signal.selectionBefore) &&
        recent(signal.at, candidate.insertedAt, PSEUDO_INPUT_ASSOCIATION_MS);
      this.pendingDelete = {
        at: signal.at,
        range: { from: signal.from, to: signal.to },
        text: signal.deletedText,
        trigger: "korean-key",
        initialFragment: exactInitialFragmentDelete
          ? { ...candidate, range: { ...candidate.range } }
          : undefined,
      };
      if (!exactInitialFragmentDelete) this.clearSingleRewriteEvidence();
    } else {
      this.pendingDelete = undefined;
      this.clearSingleRewriteEvidence();
    }
    return { kind: "allow" };
  }

  private evaluateInsert(signal: PseudoTransactionSignal): PseudoDecision {
    const beforeInput = this.beforeInput;
    const recentInsertBeforeInput =
      beforeInput?.inputType === "insertText" &&
      beforeInput.data === signal.insert &&
      recent(signal.at, beforeInput.at, PSEUDO_INPUT_ASSOCIATION_MS);

    const replayGuard = this.pendingPostDeleteReplayGuard;
    if (replayGuard) {
      const matchesReplay =
        signal.at <= replayGuard.expiresAt &&
        recentInsertBeforeInput &&
        inputTypeEvent(signal.userEvent) &&
        isHangulText(signal.insert) &&
        signal.from === signal.to &&
        signal.from === replayGuard.destination.from &&
        sameSelection(signal.selectionBefore, replayGuard.destination);
      if (matchesReplay) {
        const decision: PseudoDecision = {
          kind: "suppress-stale-replay",
          insert: signal.insert,
          destination: { ...replayGuard.destination },
          armedAt: replayGuard.armedAt,
          armReason: replayGuard.armReason,
        };
        this.disarmPostDeleteReplayGuard("suppressed-one-shot");
        return decision;
      }
      this.disarmPostDeleteReplayGuard("non-matching-input-transaction");
    }

    const rewind = this.nativeBackspaceRewind;
    if (
      rewind?.phase === "spill-suppressed" &&
      rewind.spillAt !== undefined &&
      signal.at - rewind.spillAt <= PSEUDO_REWRITE_PAIR_MS &&
      recentInsertBeforeInput &&
      inputTypeEvent(signal.userEvent) &&
      isHangulText(signal.insert)
    ) {
      const decision: PseudoDecision = {
        kind: "suppress-stale-replay",
        insert: signal.insert,
        destination: { ...signal.selectionBefore },
        armedAt: rewind.keyAt,
        armReason: "physical-backspace-native-rewind-spill",
      };
      this.nativeBackspaceRewind = undefined;
      return decision;
    }

    const pendingBackspace =
      this.pendingDelete?.trigger === "backspace-rewind" ? this.pendingDelete : undefined;
    if (pendingBackspace) {
      const connectedReplacement =
        rewind?.phase === "delete-accepted" &&
        signal.at - pendingBackspace.at <= PSEUDO_REWRITE_PAIR_MS &&
        recentInsertBeforeInput &&
        inputTypeEvent(signal.userEvent) &&
        signal.from === pendingBackspace.range.from &&
        signal.from === signal.to &&
        isConnectedHangulRewrite(pendingBackspace.text, signal.insert);
      this.pendingDelete = undefined;
      if (!connectedReplacement || !rewind) {
        // Without a connected native rewind there is not enough evidence to
        // discard a real Backspace result. End protection and leave it alone.
        this.nativeBackspaceRewind = undefined;
        return { kind: "allow" };
      }

      const tail = Array.from(signal.insert).at(-1) ?? "";
      this.active = true;
      this.lastRange = {
        from: signal.from + signal.insert.length - tail.length,
        to: signal.from + signal.insert.length,
      };
      this.lastText = tail;
      this.lastRewriteTime = signal.at;
      this.rewriteCount = 0;
      this.clearSingleRewriteEvidence();
      rewind.phase = "rewrite-completed";
      rewind.mutableRange = { ...this.lastRange };
      rewind.mutableText = tail;
      rewind.selection = cursorAt(this.lastRange.to);
      return { kind: "allow" };
    }

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
        this.moved.protectedSourceText,
        this.moved.nativeTailText,
        pending.intendedKey,
        signal.insert,
        pending.originalText,
        this.moved.intended?.text,
      );
      const replace = intended
        ? this.moved.intended
          ? intended.replaceWholeIntended
            ? this.moved.intended.range
            : pending.repairRange
          : { from: this.moved.destination.from, to: this.moved.destination.to }
        : { from: this.moved.destination.from, to: this.moved.destination.to };
      const repairedText = intended?.text ?? pending.intendedKey;
      const candidate = pending.initialFragment;
      if (
        candidate &&
        oneCodePoint(repairedText) &&
        syllableParts(repairedText) !== undefined &&
        sameRange(candidate.range, pending.attemptedRange) &&
        replace.from === candidate.range.from &&
        isConnectedHangulRewrite(candidate.text, repairedText)
      ) {
        this.pendingAtomicHandoff = {
          kind: "confirm",
          candidate: { ...candidate, range: { ...candidate.range } },
          deletedRange: { ...pending.attemptedRange },
          deletedText: pending.originalText,
          deletedAt: pending.at,
          replacementAt: signal.at,
        };
      } else if (
        repairedText === pending.intendedKey &&
        isCompatibilityLead(repairedText) &&
        oneCodePoint(repairedText)
      ) {
        this.pendingAtomicHandoff = {
          kind: "seed",
          insertedAt: signal.at,
          key: pending.intendedKey,
        };
      } else {
        this.pendingAtomicHandoff = undefined;
      }
      this.pendingStaleDelete = undefined;
      return {
        kind: "atomic-repair",
        insert: repairedText,
        replace,
        staleText: this.moved.nativeTailText,
        originalText: pending.originalText,
        source: intended?.source ?? "pending-intended-key",
        nativeTailText: signal.insert,
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
      const candidate = pending.initialFragment;
      const replacementRange = {
        from: signal.from,
        to: signal.from + signal.insert.length,
      };
      const confirmedSingleRewrite =
        candidate !== undefined &&
        previousWasTracked &&
        oneCodePoint(signal.insert) &&
        syllableParts(signal.insert) !== undefined &&
        signal.docChanged &&
        signal.from === candidate.range.from &&
        recent(signal.at, candidate.insertedAt, PSEUDO_INPUT_ASSOCIATION_MS);
      this.active = true;
      this.lastRange = {
        from: signal.from + signal.insert.length - tailLength,
        to: signal.from + signal.insert.length,
      };
      this.lastText = tail;
      this.lastRewriteTime = signal.at;
      this.rewriteCount = previousWasTracked ? this.rewriteCount + 1 : 1;
      if (confirmedSingleRewrite && candidate) {
        this.singleRewriteLineage = {
          initialText: candidate.text,
          initialRange: { ...candidate.range },
          deletedText: pending.text,
          deletedRange: { ...pending.range },
          replacementText: signal.insert,
          replacementRange,
          rewriteIntervalMs: signal.at - candidate.insertedAt,
          deleteInsertIntervalMs: signal.at - pending.at,
        };
        this.diagnostics.push({
          eventType: "single-rewrite-lineage-confirmed",
          details: { ...copyLineage(this.singleRewriteLineage) },
        });
      } else {
        this.singleRewriteLineage = undefined;
      }
      this.initialFragmentCandidate = undefined;
      this.pendingDelete = undefined;
      return { kind: "allow" };
    }

    this.pendingDelete = undefined;
    if (recentInsertBeforeInput && inputTypeEvent(signal.userEvent) && isHangulText(signal.insert)) {
      if (this.moved) this.clearCompositionState();
      const tail = Array.from(signal.insert).at(-1) ?? "";
      this.active = true;
      this.lastRange = {
        from: signal.from + signal.insert.length - tail.length,
        to: signal.from + signal.insert.length,
      };
      this.lastText = tail;
      this.lastRewriteTime = signal.at;
      this.rewriteCount = 0;
      const keydown = this.keydown;
      const eligibleInitialFragment =
        signal.docChanged &&
        isCompatibilityLead(signal.insert) &&
        collapsed(signal.selectionBefore) &&
        signal.selectionBefore.from === signal.from &&
        this.keydownSelection !== undefined &&
        sameSelection(this.keydownSelection, signal.selectionBefore) &&
        keydown !== undefined &&
        keydown.key === signal.insert &&
        isHangulInputKey(keydown.key) &&
        !keydown.isComposing &&
        !keydown.altKey &&
        !keydown.ctrlKey &&
        !keydown.metaKey &&
        recent(signal.at, keydown.at, PSEUDO_INPUT_ASSOCIATION_MS);
      this.initialFragmentCandidate = eligibleInitialFragment
        ? {
            insertedAt: signal.at,
            range: { from: signal.from, to: signal.from + signal.insert.length },
            text: signal.insert,
            key: keydown.key,
          }
        : undefined;
      this.singleRewriteLineage = undefined;
    }
    return { kind: "allow" };
  }

  private deriveIntendedText(
    protectedSourceText: string,
    nativeTailText: string,
    key: string,
    inserted: string,
    replacedText: string,
    intendedText: string | undefined,
  ):
    | {
        text: string;
        source: "derived" | "native-rewrite";
        replaceWholeIntended?: boolean;
      }
    | undefined {
    if (!isHangulInputKey(key)) return undefined;
    if (
      intendedText !== undefined &&
      nativeResultConsumesPendingSequence(intendedText, key, inserted)
    ) {
      return { text: inserted, source: "native-rewrite", replaceWholeIntended: true };
    }
    if (
      intendedText !== undefined &&
      (oneCodePoint(inserted) || replacedText === nativeTailText) &&
      isDirectHangulRewrite(replacedText, inserted)
    ) {
      return { text: inserted, source: "native-rewrite" };
    }
    for (const carry of new Set([nativeTailText, protectedSourceText])) {
      const suffix = nativeCarrySuffix(carry, inserted);
      if (suffix) return { text: suffix, source: "derived" };
      if (attachFinalConsonant(carry, key) === inserted) {
        return { text: key, source: "derived" };
      }
    }
    if (intendedText !== undefined && isDirectHangulRewrite(replacedText, inserted)) {
      return { text: inserted, source: "native-rewrite" };
    }
    return undefined;
  }

  private expirePostDeleteReplayGuard(at: number): void {
    if (this.pendingPostDeleteReplayGuard && at > this.pendingPostDeleteReplayGuard.expiresAt) {
      this.disarmPostDeleteReplayGuard("timeout");
    }
  }

  private currentMutableTail(): { range: TextRange; text: string } | undefined {
    const intended = this.moved?.intended;
    if (intended && intended.text.length > 0) {
      const text = Array.from(intended.text).at(-1) ?? "";
      return text
        ? {
            range: { from: intended.range.to - text.length, to: intended.range.to },
            text,
          }
        : undefined;
    }
    if (this.active && this.lastRange && this.lastText) {
      return { range: { ...this.lastRange }, text: this.lastText };
    }
    return undefined;
  }

  private disarmPostDeleteReplayGuard(reason: string): void {
    const guard = this.pendingPostDeleteReplayGuard;
    if (!guard) return;
    this.pendingPostDeleteReplayGuard = undefined;
    this.diagnostics.push({
      eventType: "post-delete-guard-disarmed",
      details: {
        reason,
        armedAt: guard.armedAt,
        destination: { ...guard.destination },
        deletedRange: { ...guard.deletedRange },
      },
    });
  }

  private clearCompositionState(): void {
    this.active = false;
    this.lastRange = undefined;
    this.lastText = "";
    this.lastRewriteTime = 0;
    this.rewriteCount = 0;
    this.pendingDelete = undefined;
    this.pendingStaleDelete = undefined;
    this.pendingAtomicHandoff = undefined;
    this.nativeBackspaceRewind = undefined;
    this.preserveNextMovedDocumentTransaction = false;
    this.moved = undefined;
    this.clearSingleRewriteEvidence();
    this.keydownSelection = undefined;
  }

  private clearSingleRewriteEvidence(): void {
    this.initialFragmentCandidate = undefined;
    this.singleRewriteLineage = undefined;
  }
}
