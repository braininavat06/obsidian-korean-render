export interface SelectionSnapshot {
  from: number;
  to: number;
}

export type SelectionOrigin = "select" | "select.pointer" | "other";

export interface BeforeInputSignal {
  at: number;
  data: string | null;
  inputType: string;
  isComposing: boolean;
}

export interface KeySignal {
  at: number;
  key: string;
  isComposing: boolean;
}

export interface SelectionMoveSignal {
  at: number;
  before: SelectionSnapshot;
  after: SelectionSnapshot;
  origin: SelectionOrigin;
  textBeforeCursor: string;
}

export interface InputTransactionSignal {
  at: number;
  from: number;
  to: number;
  insert: string;
  changeCount: number;
  userEvent: string | undefined;
  selectionBefore: SelectionSnapshot;
  sourceStillPresent: boolean;
}

export interface SuppressionDecision {
  suppress: boolean;
  reason?: "stale-composition-insert" | "stale-composition-before-backspace";
  sourceFrom?: number;
  sourceTo?: number;
}

interface CompositionState {
  active: boolean;
  text: string;
}

interface MovedComposition {
  text: string;
  sourceFrom: number;
  sourceTo: number;
  destination: SelectionSnapshot;
  movedAt: number;
  origin: SelectionOrigin;
}

export const MOVE_WINDOW_MS = 1_000;
export const INPUT_ASSOCIATION_MS = 150;
export function isKoreanCompositionText(text: string): boolean {
  return /^[\uac00-\ud7a3]$/u.test(text);
}

function sameSelection(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  return a.from === b.from && a.to === b.to;
}

function collapsed(selection: SelectionSnapshot): boolean {
  return selection.from === selection.to;
}

/**
 * Pure, DOM-independent evidence tracker. It deliberately has no fallback for
 * Korean keyboards that omit composition events: without a marked-composition
 * boundary, an intentional repeated character cannot be distinguished safely.
 */
export class KoreanImeStateMachine {
  private composition: CompositionState = { active: false, text: "" };
  private moved: MovedComposition | undefined;
  private beforeInput: BeforeInputSignal | undefined;
  private keydown: KeySignal | undefined;

  onCompositionStart(): void {
    this.composition = { active: true, text: "" };
    this.moved = undefined;
  }

  onCompositionUpdate(data: string): void {
    this.composition.active = true;
    if (this.moved) {
      if (data !== this.moved.text) this.moved = undefined;
      return;
    }
    this.composition.text = isKoreanCompositionText(data) ? data : "";
  }

  onCompositionEnd(data: string): void {
    this.composition.active = false;
    if (this.moved) {
      if (data && data !== this.moved.text) this.moved = undefined;
      return;
    }
    this.composition.text = isKoreanCompositionText(data) ? data : "";
  }

  onBeforeInput(signal: BeforeInputSignal): void {
    this.beforeInput = signal;
  }

  onKeyDown(signal: KeySignal): void {
    this.keydown = signal;
  }

  onSelectionMove(signal: SelectionMoveSignal): void {
    if (
      signal.origin === "other" ||
      sameSelection(signal.before, signal.after) ||
      !collapsed(signal.after)
    ) {
      this.moved = undefined;
      return;
    }

    if (
      this.moved &&
      signal.at - this.moved.movedAt <= MOVE_WINDOW_MS &&
      sameSelection(signal.before, this.moved.destination)
    ) {
      this.moved.destination = signal.after;
      this.moved.movedAt = signal.at;
      this.moved.origin = signal.origin;
      return;
    }

    const text = this.composition.text;
    if (!this.composition.active || !collapsed(signal.before) || !isKoreanCompositionText(text)) {
      this.moved = undefined;
      return;
    }

    const sourceTo = signal.before.to;
    const sourceFrom = sourceTo - text.length;
    if (sourceFrom < 0 || !signal.textBeforeCursor.endsWith(text)) {
      this.moved = undefined;
      return;
    }

    this.moved = {
      text,
      sourceFrom,
      sourceTo,
      destination: signal.after,
      movedAt: signal.at,
      origin: signal.origin,
    };
  }

  onTransaction(userEvent: string | undefined, docChanged: boolean): void {
    if (!this.moved || !docChanged) return;
    void userEvent;
    this.moved = undefined;
  }

  evaluate(signal: InputTransactionSignal): SuppressionDecision {
    const moved = this.moved;
    if (!moved) return { suppress: false };

    const expired = signal.at - moved.movedAt > MOVE_WINDOW_MS;
    const exactSingleInsertion =
      signal.changeCount === 1 &&
      signal.from === signal.to &&
      signal.from === moved.destination.from &&
      signal.insert === moved.text;
    const exactCompositionContinuation = signal.userEvent === "input.type.compose";
    const safeSelection = collapsed(signal.selectionBefore) && sameSelection(signal.selectionBefore, moved.destination);

    if (
      expired ||
      !moved.origin.startsWith("select") ||
      !exactSingleInsertion ||
      !exactCompositionContinuation ||
      !safeSelection ||
      !signal.sourceStillPresent
    ) {
      return { suppress: false };
    }

    const beforeInput = this.beforeInput;
    const recentBeforeInput =
      beforeInput !== undefined &&
      signal.at >= beforeInput.at &&
      signal.at - beforeInput.at <= INPUT_ASSOCIATION_MS;

    const staleCompositionInsert =
      recentBeforeInput &&
      beforeInput.inputType === "insertCompositionText" &&
      beforeInput.data === moved.text;

    const keydown = this.keydown;
    const recentBackspace =
      keydown !== undefined &&
      keydown.key === "Backspace" &&
      signal.at >= keydown.at &&
      signal.at - keydown.at <= INPUT_ASSOCIATION_MS;
    const staleBeforeBackspace =
      recentBeforeInput && beforeInput.inputType === "deleteContentBackward" && recentBackspace;

    if (!staleCompositionInsert && !staleBeforeBackspace) return { suppress: false };

    this.moved = undefined;
    return {
      suppress: true,
      reason: staleBeforeBackspace
        ? "stale-composition-before-backspace"
        : "stale-composition-insert",
      sourceFrom: moved.sourceFrom,
      sourceTo: moved.sourceTo,
    };
  }

  getMovedComposition(): Readonly<MovedComposition> | undefined {
    return this.moved;
  }
}
