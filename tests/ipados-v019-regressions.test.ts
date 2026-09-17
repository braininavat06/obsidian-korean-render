import { describe, expect, it } from "vitest";

import type { SelectionSnapshot } from "../src/ime-state-machine";
import {
  KoreanPseudoCompositionStateMachine,
  type PseudoTransactionSignal,
} from "../src/pseudo-composition-state-machine";
import { IPADOS_V019_REGRESSIONS } from "./fixtures/ipados-v019-regressions";

const cursor = (position: number): SelectionSnapshot => ({ from: position, to: position });

function transaction(
  at: number,
  from: number,
  to: number,
  insert: string,
  deletedText: string,
  selectionBefore: SelectionSnapshot,
  overrides: Partial<PseudoTransactionSignal> = {},
): PseudoTransactionSignal {
  return {
    at,
    from,
    to,
    insert,
    deletedText,
    changeCount: 1,
    docChanged: true,
    userEvent: "input.type",
    selectionBefore,
    selectionAfter: cursor(from + insert.length),
    sourceStillPresent: true,
    ...overrides,
  };
}

function key(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  value: string,
  position: number,
  modifiers: Partial<{
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {},
): void {
  machine.onKeyDown(
    { at, key: value, isComposing: false, ...modifiers },
    cursor(position),
  );
}

function beforeDelete(machine: KoreanPseudoCompositionStateMachine, at: number): void {
  machine.onBeforeInput({
    at,
    data: null,
    inputType: "deleteContentBackward",
    isComposing: false,
  });
}

function beforeInsert(machine: KoreanPseudoCompositionStateMachine, at: number, data: string): void {
  machine.onBeforeInput({ at, data, inputType: "insertText", isComposing: false });
}

function initial(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  position: number,
  text: string,
): void {
  key(machine, at, text, position);
  beforeInsert(machine, at + 1, text);
  expect(machine.evaluate(transaction(at + 2, position, position, text, "", cursor(position))))
    .toEqual({ kind: "allow" });
}

function rewrite(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  position: number,
  previous: string,
  replacement: string,
  inputKey: string,
): void {
  const cursorPosition = position + previous.length;
  key(machine, at, inputKey, cursorPosition);
  beforeDelete(machine, at + 1);
  expect(machine.evaluate(transaction(
    at + 2,
    position,
    position + previous.length,
    "",
    previous,
    cursor(cursorPosition),
  ))).toEqual({ kind: "allow" });
  beforeInsert(machine, at + 3, replacement);
  expect(machine.evaluate(transaction(
    at + 4,
    position,
    position,
    replacement,
    "",
    cursor(position),
  ))).toEqual({ kind: "allow" });
}

function seedHighConfidenceGo(
  machine: KoreanPseudoCompositionStateMachine,
  position: number,
): void {
  initial(machine, 0, position, "ㅁ");
  rewrite(machine, 10, position, "ㅁ", "무", "ㅜ");
  rewrite(machine, 20, position, "무", "물", "ㄹ");
  rewrite(machine, 30, position, "물", "묽", "ㄱ");
  rewrite(machine, 40, position, "묽", "물고", "ㅗ");
  expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
    active: true,
    lastText: "고",
    guardConfidence: "multi-rewrite",
  });
}

function continueGoToGwa(
  machine: KoreanPseudoCompositionStateMachine,
  position: number,
): void {
  const fixture = IPADOS_V019_REGRESSIONS.confidenceCarry;
  key(machine, 50, fixture.key, position + 1);
  beforeDelete(machine, 51);
  expect(machine.evaluate(transaction(
    52,
    position,
    position + 1,
    "",
    fixture.provenTail,
    cursor(position + 1),
  ))).toEqual({ kind: "allow" });
  beforeInsert(machine, 53, fixture.nativeReplacement);
  expect(machine.evaluate(transaction(
    54,
    position,
    position,
    fixture.nativeReplacement,
    "",
    cursor(position),
  ))).toEqual({ kind: "allow" });
}

function seedHighConfidenceSan(
  machine: KoreanPseudoCompositionStateMachine,
  position: number,
): void {
  initial(machine, 0, position, "ㅅ");
  rewrite(machine, 10, position, "ㅅ", "사", "ㅏ");
  rewrite(machine, 20, position, "사", "산", "ㄴ");
  expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
    active: true,
    lastText: "산",
    rewriteCount: 2,
    guardConfidence: "multi-rewrite",
  });
}

function moveTwice(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  sourceEnd: number,
  destination: number,
  textBeforeCursor: string,
): void {
  expect(machine.onSelectionMove({
    at,
    before: cursor(sourceEnd),
    after: cursor(sourceEnd - 1),
    origin: "select",
    textBeforeCursor,
  })).toBe(true);
  expect(machine.onSelectionMove({
    at: at + 1,
    before: cursor(sourceEnd - 1),
    after: cursor(destination),
    origin: "select",
    textBeforeCursor: "",
  })).toBe(true);
}

describe("anonymized iPadOS v0.1.9 regressions", () => {
  for (const movedCase of IPADOS_V019_REGRESSIONS.confidenceCarry.movedCases) {
    it(`retains proven confidence across 고 → 과 and blocks raw ${movedCase.staleNative}`, () => {
      const machine = new KoreanPseudoCompositionStateMachine();
      // The final `물고` replacement leaves the active native tail (`고`)
      // one code point after the original rewrite range.
      seedHighConfidenceGo(machine, 4);
      continueGoToGwa(machine, 5);

      expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
        active: true,
        lastText: "과",
        guardConfidence: "multi-rewrite",
      });
      moveTwice(machine, 60, 6, 4, "xxxxx과");
      expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
        protectedSourceText: "과",
        destination: cursor(4),
        guardConfidence: "multi-rewrite",
      });

      key(machine, 70, movedCase.key, 4);
      beforeDelete(machine, 71);
      expect(machine.evaluate(transaction(72, 3, 4, "", "해", cursor(4))))
        .toMatchObject({
          kind: "suppress-stale-delete",
          originalText: "해",
        });
      beforeInsert(machine, 73, movedCase.staleNative);
      expect(machine.evaluate(transaction(
        74,
        4,
        4,
        movedCase.staleNative,
        "",
        cursor(4),
      ))).toMatchObject({
        kind: "atomic-repair",
        insert: movedCase.key,
      });
    });
  }

  it("does not carry confidence across true session boundaries", () => {
    const space = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceGo(space, 5);
    key(space, 50, " ", 6);
    expect(space.getDebugSnapshot().pseudoComposition.active).toBe(false);

    const enter = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceGo(enter, 5);
    key(enter, 50, "Enter", 6);
    expect(enter.getDebugSnapshot().pseudoComposition.active).toBe(false);

    const paste = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceGo(paste, 5);
    paste.onBeforeInput({
      at: 50,
      data: "붙여넣기",
      inputType: "insertFromPaste",
      isComposing: false,
    });
    expect(paste.getDebugSnapshot().pseudoComposition.active).toBe(false);

    const undo = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceGo(undo, 5);
    undo.onDocumentTransaction("undo", true);
    expect(undo.getDebugSnapshot().pseudoComposition.active).toBe(false);

    const replacement = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceGo(replacement, 5);
    replacement.onSelectionMove({
      at: 50,
      before: cursor(6),
      after: { from: 1, to: 4 },
      origin: "select.pointer",
      textBeforeCursor: "xxxxx과",
    });
    expect(replacement.getDebugSnapshot().pseudoComposition.active).toBe(false);
  });

  it("preserves a proven 산 lineage across bare Control and protects the cursor move", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    const fixture = IPADOS_V019_REGRESSIONS.bareModifier;
    seedHighConfidenceSan(machine, 5);

    key(machine, 30, fixture.modifier, 6, { ctrlKey: true });
    expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
      active: true,
      lastText: fixture.provenTail,
      guardConfidence: "multi-rewrite",
    });

    key(machine, 31, "ArrowLeft", 6);
    expect(machine.onSelectionMove({
      at: 32,
      before: cursor(6),
      after: cursor(4),
      origin: "select",
      textBeforeCursor: "xxxxx산",
    })).toBe(true);
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      protectedSourceText: fixture.provenTail,
      destination: cursor(4),
    });

    key(machine, 40, fixture.key, 4);
    beforeDelete(machine, 41);
    expect(machine.evaluate(transaction(42, 3, 4, "", "강", cursor(4))))
      .toMatchObject({ kind: "suppress-stale-delete", originalText: "강" });
    beforeInsert(machine, 43, fixture.staleNative);
    expect(machine.evaluate(transaction(
      44,
      4,
      4,
      fixture.staleNative,
      "",
      cursor(4),
    ))).toMatchObject({ kind: "atomic-repair", insert: fixture.key });
  });

  it("preserves modifier-only state but terminates it on command evidence", () => {
    const modifierOnly = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceSan(modifierOnly, 5);
    key(modifierOnly, 30, "Control", 6, { ctrlKey: true });
    key(modifierOnly, 31, "Shift", 6, { shiftKey: true });
    expect(modifierOnly.getDebugSnapshot().pseudoComposition.active).toBe(true);

    key(modifierOnly, 32, "ArrowLeft", 6, { ctrlKey: true });
    expect(modifierOnly.onSelectionMove({
      at: 33,
      before: cursor(6),
      after: cursor(2),
      origin: "select",
      textBeforeCursor: "xxxxx산",
    })).toBe(true);
    expect(modifierOnly.getDebugSnapshot().movedGuard).toMatchObject({
      protectedSourceText: "산",
      destination: cursor(2),
    });

    const undo = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceSan(undo, 5);
    key(undo, 30, "z", 6, { metaKey: true });
    expect(undo.getDebugSnapshot().pseudoComposition.active).toBe(true);
    undo.onDocumentTransaction("undo", true);
    expect(undo.getDebugSnapshot().pseudoComposition.active).toBe(false);

    const paste = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceSan(paste, 5);
    key(paste, 30, "v", 6, { metaKey: true });
    paste.onBeforeInput({
      at: 31,
      data: "text",
      inputType: "insertFromPaste",
      isComposing: false,
    });
    expect(paste.getDebugSnapshot().pseudoComposition.active).toBe(false);

    const cut = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceSan(cut, 5);
    key(cut, 30, "x", 6, { metaKey: true });
    cut.onDocumentTransaction("delete.cut", true);
    expect(cut.getDebugSnapshot().pseudoComposition.active).toBe(false);

    const english = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceSan(english, 5);
    key(english, 30, "a", 6);
    expect(english.getDebugSnapshot().pseudoComposition.active).toBe(false);

    const number = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceSan(number, 5);
    key(number, 30, "1", 6);
    expect(number.getDebugSnapshot().pseudoComposition.active).toBe(false);
  });
});
