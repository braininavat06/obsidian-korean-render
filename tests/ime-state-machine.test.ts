import { describe, expect, it } from "vitest";

import {
  KoreanImeStateMachine,
  type InputTransactionSignal,
  type SelectionSnapshot,
} from "../src/ime-state-machine";

const cursor = (position: number): SelectionSnapshot => ({ from: position, to: position });

function staleTransaction(
  at: number,
  position: number,
  insert = "다",
): InputTransactionSignal {
  return {
    at,
    from: position,
    to: position,
    insert,
    changeCount: 1,
    userEvent: "input.type.compose",
    selectionBefore: cursor(position),
    sourceStillPresent: true,
  };
}

function composeAndMove(
  machine: KoreanImeStateMachine,
  origin: "select" | "select.pointer" = "select",
): void {
  machine.onCompositionStart();
  machine.onCompositionUpdate("다");
  machine.onSelectionMove({
    at: 100,
    before: cursor(8),
    after: cursor(3),
    origin,
    textBeforeCursor: "1234567다",
  });
}

describe("KoreanImeStateMachine", () => {
  it("does not modify normal continuous Korean composition", () => {
    const machine = new KoreanImeStateMachine();
    machine.onCompositionStart();
    machine.onCompositionUpdate("한");
    machine.onBeforeInput({
      at: 100,
      data: "한",
      inputType: "insertCompositionText",
      isComposing: true,
    });

    expect(machine.evaluate(staleTransaction(110, 1, "한"))).toEqual({ suppress: false });
  });

  it("never intervenes in English input", () => {
    const machine = new KoreanImeStateMachine();
    machine.onCompositionStart();
    machine.onCompositionUpdate("a");
    machine.onSelectionMove({
      at: 100,
      before: cursor(1),
      after: cursor(0),
      origin: "select",
      textBeforeCursor: "a",
    });
    machine.onBeforeInput({ at: 110, data: "a", inputType: "insertText", isComposing: false });

    expect(machine.evaluate(staleTransaction(115, 0, "a"))).toEqual({ suppress: false });
  });

  it("does not auto-correct a single compatibility Jamo", () => {
    const machine = new KoreanImeStateMachine();
    machine.onCompositionStart();
    machine.onCompositionUpdate("ㄷ");
    machine.onSelectionMove({
      at: 100,
      before: cursor(1),
      after: cursor(0),
      origin: "select",
      textBeforeCursor: "ㄷ",
    });
    machine.onBeforeInput({
      at: 110,
      data: "ㄷ",
      inputType: "insertCompositionText",
      isComposing: true,
    });

    expect(machine.evaluate(staleTransaction(115, 0, "ㄷ"))).toEqual({ suppress: false });
  });

  it("does not modify a normal Backspace", () => {
    const machine = new KoreanImeStateMachine();
    machine.onKeyDown({ at: 100, key: "Backspace", isComposing: false });
    machine.onBeforeInput({
      at: 105,
      data: null,
      inputType: "deleteContentBackward",
      isComposing: false,
    });

    expect(
      machine.evaluate({
        ...staleTransaction(110, 3, ""),
        from: 2,
        to: 3,
        insert: "",
        userEvent: "delete.backward",
      }),
    ).toEqual({ suppress: false });
  });

  it("suppresses an exact stale composition insertion after cursor movement", () => {
    const machine = new KoreanImeStateMachine();
    composeAndMove(machine);
    machine.onBeforeInput({
      at: 110,
      data: "다",
      inputType: "insertCompositionText",
      isComposing: true,
    });

    expect(machine.evaluate(staleTransaction(115, 3))).toEqual({
      suppress: true,
      reason: "stale-composition-insert",
      sourceFrom: 7,
      sourceTo: 8,
    });
  });

  it("does not delete an intentional repeated character after a new composition starts", () => {
    const machine = new KoreanImeStateMachine();
    composeAndMove(machine);
    machine.onCompositionEnd("다");
    machine.onCompositionStart();
    machine.onCompositionUpdate("다");
    machine.onBeforeInput({
      at: 110,
      data: "다",
      inputType: "insertCompositionText",
      isComposing: true,
    });

    expect(machine.evaluate(staleTransaction(115, 3))).toEqual({ suppress: false });
  });

  it("invalidates the candidate on undo and redo", () => {
    for (const userEvent of ["undo", "redo"]) {
      const machine = new KoreanImeStateMachine();
      composeAndMove(machine);
      machine.onTransaction(userEvent, true);
      machine.onBeforeInput({
        at: 110,
        data: "다",
        inputType: "insertCompositionText",
        isComposing: true,
      });
      expect(machine.evaluate(staleTransaction(115, 3))).toEqual({ suppress: false });
    }
  });

  it("does not arm while a selection range exists", () => {
    const machine = new KoreanImeStateMachine();
    machine.onCompositionStart();
    machine.onCompositionUpdate("다");
    machine.onSelectionMove({
      at: 100,
      before: cursor(8),
      after: { from: 2, to: 4 },
      origin: "select.pointer",
      textBeforeCursor: "1234567다",
    });
    machine.onBeforeInput({
      at: 110,
      data: "다",
      inputType: "insertCompositionText",
      isComposing: true,
    });

    expect(
      machine.evaluate({ ...staleTransaction(115, 2), selectionBefore: { from: 2, to: 4 } }),
    ).toEqual({ suppress: false });
  });

  it("tracks the destination through rapid arrow-key movement", () => {
    const machine = new KoreanImeStateMachine();
    composeAndMove(machine);
    machine.onSelectionMove({
      at: 120,
      before: cursor(3),
      after: cursor(2),
      origin: "select",
      textBeforeCursor: "1234567다",
    });
    machine.onSelectionMove({
      at: 140,
      before: cursor(2),
      after: cursor(1),
      origin: "select",
      textBeforeCursor: "1234567다",
    });
    machine.onBeforeInput({
      at: 150,
      data: "다",
      inputType: "insertCompositionText",
      isComposing: true,
    });

    expect(machine.evaluate(staleTransaction(155, 1)).suppress).toBe(true);
  });

  it("handles touch selection movement with the same strict evidence", () => {
    const machine = new KoreanImeStateMachine();
    composeAndMove(machine, "select.pointer");
    machine.onBeforeInput({
      at: 110,
      data: "다",
      inputType: "insertCompositionText",
      isComposing: true,
    });

    expect(machine.evaluate(staleTransaction(115, 3)).suppress).toBe(true);
  });

  it("suppresses a pure stale insertion immediately before a signaled Backspace", () => {
    const machine = new KoreanImeStateMachine();
    composeAndMove(machine);
    machine.onKeyDown({ at: 105, key: "Backspace", isComposing: false });
    machine.onBeforeInput({
      at: 110,
      data: null,
      inputType: "deleteContentBackward",
      isComposing: false,
    });

    expect(machine.evaluate(staleTransaction(115, 3)).reason).toBe(
      "stale-composition-before-backspace",
    );
  });

  it("rejects late, replacement, multi-change, and newly-started transactions", () => {
    const variants: Partial<InputTransactionSignal>[] = [
      { at: 1_200 },
      { from: 2, to: 3 },
      { changeCount: 2 },
      { userEvent: "input.type.compose.start" },
      { sourceStillPresent: false },
    ];

    for (const variant of variants) {
      const machine = new KoreanImeStateMachine();
      composeAndMove(machine);
      machine.onBeforeInput({
        at: variant.at === 1_200 ? 1_190 : 110,
        data: "다",
        inputType: "insertCompositionText",
        isComposing: true,
      });
      expect(machine.evaluate({ ...staleTransaction(115, 3), ...variant })).toEqual({
        suppress: false,
      });
    }
  });
});
