import { describe, expect, it } from "vitest";

import type { SelectionSnapshot } from "../src/ime-state-machine";
import {
  KoreanPseudoCompositionStateMachine,
  type PseudoDecision,
  type PseudoTransactionSignal,
} from "../src/pseudo-composition-state-machine";
import { IPADOS_V010_HISTORY_BACKSPACE } from "./fixtures/ipados-v010-history-backspace";

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
): void {
  machine.onKeyDown({ at, key: value, isComposing: false, repeat: false }, cursor(position));
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
  key(machine, at, inputKey, position + previous.length);
  beforeDelete(machine, at + 1);
  expect(machine.evaluate(transaction(
    at + 2,
    position,
    position + previous.length,
    "",
    previous,
    cursor(position + previous.length),
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

function seedIt(machine: KoreanPseudoCompositionStateMachine, position: number): void {
  initial(machine, 0, position, "ㅇ");
  rewrite(machine, 10, position, "ㅇ", "이", "ㅣ");
  rewrite(machine, 20, position, "이", "잇", "ㅅ");
}

function seedSa(machine: KoreanPseudoCompositionStateMachine, position: number): void {
  initial(machine, 0, position, "ㅅ");
  rewrite(machine, 10, position, "ㅅ", "사", "ㅏ");
}

function seedHighConfidenceGwa(
  machine: KoreanPseudoCompositionStateMachine,
  position: number,
): void {
  initial(machine, 0, position, "ㅁ");
  rewrite(machine, 10, position, "ㅁ", "무", "ㅜ");
  rewrite(machine, 20, position, "무", "물", "ㄹ");
  rewrite(machine, 30, position, "물", "묽", "ㄱ");
  rewrite(machine, 40, position, "묽", "물고", "ㅗ");
  rewrite(machine, 50, position + 1, "고", "과", "ㅏ");
  expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
    lastText: "과",
    guardConfidence: "multi-rewrite",
  });
}

function exactBackspaceDeleteOrder(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  position: number,
  deletedText: string,
): PseudoDecision {
  key(machine, at, "Backspace", position);
  expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("armed");
  beforeDelete(machine, at + 1);
  const decision = machine.evaluate(transaction(
    at + 2,
    position - deletedText.length,
    position,
    "",
    deletedText,
    cursor(position),
    {
      userEvent: "delete.backward",
      selectionAfter: cursor(position - deletedText.length),
    },
  ));
  expect(machine.getDebugSnapshot().nativeBackspaceRewind).toMatchObject({
    phase: "delete-accepted",
    deleteApplied: false,
  });

  key(machine, at + 3, "Backspace", position);
  expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("delete-accepted");

  expect(machine.onSelectionMove({
    at: at + 4,
    before: cursor(position),
    after: cursor(position - deletedText.length),
    origin: "other",
    textBeforeCursor: "",
  })).toBe(false);
  expect(machine.getDebugSnapshot().nativeBackspaceRewind).toMatchObject({
    phase: "delete-accepted",
    deleteApplied: false,
  });

  machine.onDocumentTransaction(
    "delete.backward",
    true,
    false,
    cursor(position - deletedText.length),
  );
  expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("delete-accepted");
  machine.onAppliedTransaction({
    at: at + 5,
    userEvent: "delete.backward",
    docChanged: true,
    changeCount: 1,
    from: position - deletedText.length,
    to: position,
    insert: "",
    selectionBefore: cursor(position),
    selectionAfter: cursor(position - deletedText.length),
  });
  expect(machine.getDebugSnapshot().nativeBackspaceRewind).toMatchObject({
    phase: "delete-accepted",
    deleteApplied: true,
  });
  return decision;
}

function nativeBackspaceReplacement(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  position: number,
  replacement: string,
): PseudoDecision {
  beforeInsert(machine, at, replacement);
  return machine.evaluate(transaction(
    at + 1,
    position,
    position,
    replacement,
    "",
    cursor(position),
  ));
}

describe("anonymized iPadOS v0.1.10 history and Backspace ordering", () => {
  it("allows the exact 잇 → 이 → ㅇ → empty native rewind sequence", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedIt(machine, 2);

    expect(exactBackspaceDeleteOrder(machine, 30, 3, "잇")).toEqual({ kind: "allow" });
    expect(nativeBackspaceReplacement(machine, 36, 2, "이")).toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("rewrite-completed");

    expect(exactBackspaceDeleteOrder(machine, 50, 3, "이")).toEqual({ kind: "allow" });
    expect(nativeBackspaceReplacement(machine, 56, 2, "ㅇ")).toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("rewrite-completed");

    expect(exactBackspaceDeleteOrder(machine, 70, 3, "ㅇ")).toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("delete-accepted");
  });

  it("keeps delete-accepted through duplicate keydown and pre-transaction selection change", () => {
    expect(IPADOS_V010_HISTORY_BACKSPACE.realDeleteOrder).toEqual([
      "keydown:Backspace",
      "beforeinput:deleteContentBackward",
      "input:deleteContentBackward",
      "keydown:Backspace:repeat=false",
      "selection-change:delete.backward",
      "cm-document-transaction:delete.backward",
      "native-replacement-or-replay",
    ]);
    const machine = new KoreanPseudoCompositionStateMachine();
    seedIt(machine, 2);
    exactBackspaceDeleteOrder(machine, 30, 3, "잇");
    expect(machine.getDebugSnapshot().nativeBackspaceRewind).toMatchObject({
      kind: "mutable-rewind",
      phase: "delete-accepted",
      deleteApplied: true,
    });
  });

  it("blocks document-owned spill and its no-new-key stale insertion", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedIt(machine, 2);
    exactBackspaceDeleteOrder(machine, 30, 3, "잇");
    nativeBackspaceReplacement(machine, 36, 2, "이");
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("rewrite-completed");

    beforeDelete(machine, 40);
    expect(machine.evaluate(transaction(41, 1, 2, "", "앞", cursor(2))))
      .toMatchObject({
        kind: "suppress-stale-delete",
        deleteSource: "backspace-rewind-spill",
      });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("spill-suppressed");

    beforeInsert(machine, 42, "니");
    expect(machine.evaluate(transaction(43, 2, 2, "니", "", cursor(2))))
      .toMatchObject({ kind: "suppress-stale-replay", insert: "니" });
  });

  it("ends rewind protection when a real new Korean key arrives", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedIt(machine, 2);
    exactBackspaceDeleteOrder(machine, 30, 3, "잇");
    nativeBackspaceReplacement(machine, 36, 2, "이");

    key(machine, 50, "ㄴ", 3);
    expect(machine.getDebugSnapshot().nativeBackspaceRewind).toBeNull();
    beforeInsert(machine, 51, "ㄴ");
    expect(machine.evaluate(transaction(52, 3, 3, "ㄴ", "", cursor(3))))
      .toEqual({ kind: "allow" });
  });

  it("allows moved Backspace deletion but suppresses connected residual replay", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedSa(machine, 5);
    expect(machine.onSelectionMove({
      at: 20,
      before: cursor(6),
      after: cursor(3),
      origin: "select",
      textBeforeCursor: "xxxxx사",
    })).toBe(true);

    expect(exactBackspaceDeleteOrder(machine, 30, 3, "나")).toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind).toMatchObject({
      kind: "moved-residual",
      nativeTailText: "사",
      confidence: "single-confirmed-lineage",
      phase: "delete-accepted",
    });
    beforeInsert(machine, 36, "사");
    expect(machine.evaluate(transaction(37, 2, 2, "사", "", cursor(2))))
      .toMatchObject({
        kind: "suppress-stale-replay",
        armReason: "physical-backspace-moved-native-residual",
      });
  });

  it("detaches proven native provenance across undo and repairs 과 → 괍", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceGwa(machine, 4);
    machine.onDocumentTransaction("undo", true, false, cursor(6));
    expect(machine.getDebugSnapshot()).toMatchObject({
      pseudoComposition: { active: false },
      detachedNativeLineage: {
        historyEvent: "undo",
        nativeTailText: "과",
        confidence: "multi-rewrite",
        destination: cursor(6),
      },
    });

    key(machine, 60, "ArrowLeft", 6);
    machine.onSelectionMove({
      at: 61,
      before: cursor(6),
      after: cursor(5),
      origin: "select",
      textBeforeCursor: "",
    });
    key(machine, 62, "ArrowLeft", 5);
    machine.onSelectionMove({
      at: 63,
      before: cursor(5),
      after: cursor(4),
      origin: "select",
      textBeforeCursor: "",
    });

    key(machine, 70, "ㅂ", 4);
    beforeDelete(machine, 71);
    expect(machine.evaluate(transaction(72, 3, 4, "", "해", cursor(4))))
      .toMatchObject({
        kind: "suppress-stale-delete",
        deleteSource: "post-history-native",
      });
    beforeInsert(machine, 73, "괍");
    const repair = machine.evaluate(transaction(74, 4, 4, "괍", "", cursor(4)));
    expect(repair).toMatchObject({
      kind: "atomic-repair",
      insert: "ㅂ",
      replace: cursor(4),
    });
    if (repair.kind !== "atomic-repair") throw new Error("expected atomic repair");
    machine.commitAtomicRepair(repair);
    expect(machine.getDebugSnapshot().detachedNativeLineage).toBeNull();
  });

  it("allows fresh unconnected Korean input after undo", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceGwa(machine, 4);
    machine.onDocumentTransaction("undo", true, false, cursor(6));
    key(machine, 60, "ㄴ", 6);
    beforeInsert(machine, 61, "나");
    expect(machine.evaluate(transaction(62, 6, 6, "나", "", cursor(6))))
      .toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot()).toMatchObject({
      pseudoComposition: { lastText: "나" },
      detachedNativeLineage: null,
    });
  });

  it("keeps navigation normal and disarms detached history state on real boundaries", () => {
    for (const boundary of ["a", "1", " "]) {
      const machine = new KoreanPseudoCompositionStateMachine();
      seedHighConfidenceGwa(machine, 4);
      machine.onDocumentTransaction("undo", true, false, cursor(6));
      key(machine, 60, "ArrowLeft", 6);
      expect(machine.onSelectionMove({
        at: 61,
        before: cursor(6),
        after: cursor(5),
        origin: "select",
        textBeforeCursor: "",
      })).toBe(false);
      expect(machine.getDebugSnapshot().detachedNativeLineage?.destination).toEqual(cursor(5));
      key(machine, 62, boundary, 5);
      expect(machine.getDebugSnapshot().detachedNativeLineage).toBeNull();
    }
  });

  it("uses the same detached provenance representation for redo without assuming corruption", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedHighConfidenceGwa(machine, 4);
    machine.onDocumentTransaction("redo", true, false, cursor(6));
    expect(machine.getDebugSnapshot().detachedNativeLineage).toMatchObject({
      historyEvent: "redo",
      nativeTailText: "과",
      destination: cursor(6),
    });
    key(machine, 60, "ㄴ", 6);
    beforeInsert(machine, 61, "나");
    expect(machine.evaluate(transaction(62, 6, 6, "나", "", cursor(6))))
      .toEqual({ kind: "allow" });
  });
});
