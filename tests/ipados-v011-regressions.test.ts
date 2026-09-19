import { describe, expect, it } from "vitest";

import type { SelectionSnapshot } from "../src/ime-state-machine";
import {
  KoreanPseudoCompositionStateMachine,
  type AtomicRepairDecision,
  type PseudoTransactionSignal,
} from "../src/pseudo-composition-state-machine";
import { IPADOS_V011_REGRESSIONS } from "./fixtures/ipados-v011-regressions";

const cursor = (position: number): SelectionSnapshot => ({ from: position, to: position });

function tx(
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
  modifiers: { metaKey?: boolean } = {},
): void {
  machine.onKeyDown({
    at,
    key: value,
    isComposing: false,
    repeat: false,
    ...modifiers,
  }, cursor(position));
}

function beforeDelete(machine: KoreanPseudoCompositionStateMachine, at: number): void {
  machine.onBeforeInput({
    at,
    data: null,
    inputType: "deleteContentBackward",
    isComposing: false,
  });
}

function beforeInsert(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  data: string,
): void {
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
  expect(machine.evaluate(tx(at + 2, position, position, text, "", cursor(position))))
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
  expect(machine.evaluate(tx(
    at + 2,
    position,
    position + previous.length,
    "",
    previous,
    cursor(position + previous.length),
  ))).toEqual({ kind: "allow" });
  beforeInsert(machine, at + 3, replacement);
  expect(machine.evaluate(tx(at + 4, position, position, replacement, "", cursor(position))))
    .toEqual({ kind: "allow" });
}

function seedProvenSa(machine: KoreanPseudoCompositionStateMachine, position: number): void {
  initial(machine, 0, position, "ㅅ");
  rewrite(machine, 10, position, "ㅅ", "사", "ㅏ");
  rewrite(machine, 20, position, "사", "산", "ㄴ");
  rewrite(machine, 30, position, "산", "사", "ㅏ");
  expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
    lastText: "사",
    guardConfidence: "multi-rewrite",
  });
}

function firstPostHistoryRepair(
  machine: KoreanPseudoCompositionStateMachine,
  position: number,
): AtomicRepairDecision {
  machine.onDocumentTransaction("undo", true, false, cursor(position));
  key(machine, 50, "ㅇ", position);
  beforeDelete(machine, 51);
  expect(machine.evaluate(tx(52, position - 1, position, "", "문", cursor(position))))
    .toMatchObject({ kind: "suppress-stale-delete", deleteSource: "post-history-native" });
  beforeInsert(machine, 53, "상");
  const repair = machine.evaluate(tx(54, position, position, "상", "", cursor(position)));
  expect(repair).toMatchObject({ kind: "atomic-repair", insert: "ㅇ" });
  if (repair.kind !== "atomic-repair") throw new Error("expected post-history repair");
  machine.commitAtomicRepair(repair);
  return repair;
}

describe("anonymized iPadOS v0.1.11 lifecycle regressions", () => {
  it("treats one docChanged+selectionSet delete.backward update atomically", () => {
    expect(IPADOS_V011_REGRESSIONS.backspaceAtomicUpdate).toContain(
      "cm-view-update:docChanged+selectionSet:delete.backward",
    );
    const machine = new KoreanPseudoCompositionStateMachine();
    initial(machine, 0, 5, "ㅇ");
    rewrite(machine, 10, 5, "ㅇ", "이", "ㅣ");
    rewrite(machine, 20, 5, "이", "잇", "ㅅ");

    key(machine, 30, "Backspace", 6);
    beforeDelete(machine, 31);
    key(machine, 33, "Backspace", 6);
    machine.onAppliedTransaction({
      at: 34,
      userEvent: "delete.backward",
      docChanged: true,
      changeCount: 1,
      from: 5,
      to: 6,
      insert: "",
      deletedText: "잇",
      selectionBefore: cursor(6),
      selectionAfter: cursor(5),
    });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind).toMatchObject({
      phase: "delete-accepted",
      deleteApplied: true,
    });
    machine.onDocumentTransaction("delete.backward", true, false, cursor(5));
    expect(machine.getDebugSnapshot().nativeBackspaceRewind).toMatchObject({
      phase: "delete-accepted",
      deleteApplied: true,
    });

    beforeInsert(machine, 35, "이");
    expect(machine.evaluate(tx(36, 5, 5, "이", "", cursor(5))))
      .toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("rewrite-completed");

    beforeDelete(machine, 37);
    expect(machine.evaluate(tx(38, 4, 5, "", "앞", cursor(5))))
      .toMatchObject({ kind: "suppress-stale-delete", deleteSource: "backspace-rewind-spill" });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("spill-suppressed");
    expect(machine.drainDiagnostics().some((entry) =>
      entry.eventType === "native-backspace-rewind-transition" &&
      entry.details.toPhase === "spill-suppressed"
    )).toBe(true);
  });

  it("keeps a moved residual through the same atomic update and blocks no-key replay", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedProvenSa(machine, 8);
    expect(machine.onSelectionMove({
      at: 40,
      before: cursor(9),
      after: cursor(5),
      origin: "select",
      textBeforeCursor: "xxxxxxxx사",
    })).toBe(true);
    key(machine, 50, "Backspace", 5);
    beforeDelete(machine, 51);
    key(machine, 53, "Backspace", 5);
    machine.onAppliedTransaction({
      at: 54,
      userEvent: "delete.backward",
      docChanged: true,
      changeCount: 1,
      from: 4,
      to: 5,
      insert: "",
      deletedText: "나",
      selectionBefore: cursor(5),
      selectionAfter: cursor(4),
    });
    machine.onDocumentTransaction("delete.backward", true, false, cursor(4));
    expect(machine.getDebugSnapshot().nativeBackspaceRewind).toMatchObject({
      kind: "moved-residual",
      phase: "delete-accepted",
      deleteApplied: true,
    });
    beforeInsert(machine, 55, "사");
    expect(machine.evaluate(tx(56, 4, 4, "사", "", cursor(4))))
      .toMatchObject({ kind: "suppress-stale-replay", insert: "사" });
  });

  it("hands the first history repair into continuing moved-style provenance", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedProvenSa(machine, 10);
    firstPostHistoryRepair(machine, 10);
    expect(machine.getDebugSnapshot()).toMatchObject({
      detachedNativeLineage: null,
      movedGuard: {
        protectedSourceText: "사",
        nativeTailText: "상",
        intendedText: "ㅇ",
        nativeState: "repairing",
      },
    });

    key(machine, 60, "ㅜ", 11);
    beforeInsert(machine, 61, "사우");
    const repair = machine.evaluate(tx(62, 11, 11, "사우", "", cursor(11)));
    expect(repair).toMatchObject({
      kind: "atomic-repair",
      insert: "우",
      replace: { from: 10, to: 11 },
      source: "native-rewrite",
    });
    if (repair.kind !== "atomic-repair") throw new Error("expected continuing repair");
    machine.commitAtomicRepair(repair);
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      intendedText: "우",
      nativeState: "synchronized",
    });
  });

  it("allows an unconnected fresh Korean output after the first history repair", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedProvenSa(machine, 10);
    firstPostHistoryRepair(machine, 10);
    key(machine, 60, "ㄴ", 11);
    beforeInsert(machine, 61, "나");
    expect(machine.evaluate(tx(62, 11, 11, "나", "", cursor(11))))
      .toEqual({ kind: "allow" });
  });

  it("ends continuing post-history provenance at explicit pointer and non-Korean boundaries", () => {
    const pointer = new KoreanPseudoCompositionStateMachine();
    seedProvenSa(pointer, 10);
    firstPostHistoryRepair(pointer, 10);
    expect(pointer.onSelectionMove({
      at: 60,
      before: cursor(11),
      after: cursor(4),
      origin: "select.pointer",
      textBeforeCursor: "",
    })).toBe(false);
    expect(pointer.getDebugSnapshot().movedGuard).toBeNull();

    for (const boundary of ["a", "1", " "]) {
      const machine = new KoreanPseudoCompositionStateMachine();
      seedProvenSa(machine, 10);
      firstPostHistoryRepair(machine, 10);
      key(machine, 60, boundary, 11);
      expect(machine.getDebugSnapshot().movedGuard).toBeNull();
    }
  });

  it("confirms ㅇ → 이 after post-history repair just like the clean path", () => {
    const clean = new KoreanPseudoCompositionStateMachine();
    initial(clean, 0, 20, "ㅇ");
    rewrite(clean, 10, 20, "ㅇ", "이", "ㅣ");
    expect(clean.getDebugSnapshot().pseudoComposition.guardConfidence)
      .toBe("single-confirmed-lineage");

    const repaired = new KoreanPseudoCompositionStateMachine();
    seedProvenSa(repaired, 10);
    firstPostHistoryRepair(repaired, 10);
    key(repaired, 60, "ㅣ", 11);
    beforeDelete(repaired, 61);
    expect(repaired.evaluate(tx(62, 10, 11, "", "ㅇ", cursor(11))))
      .toMatchObject({ kind: "suppress-stale-delete" });
    beforeInsert(repaired, 63, "이");
    const confirm = repaired.evaluate(tx(64, 10, 10, "이", "", cursor(10)));
    expect(confirm).toMatchObject({ kind: "atomic-repair", insert: "이" });
    if (confirm.kind !== "atomic-repair") throw new Error("expected lineage repair");
    repaired.commitAtomicRepair(confirm);
    expect(repaired.getDebugSnapshot().pseudoComposition).toMatchObject({
      lastText: "이",
      rewriteCount: 1,
      guardConfidence: "single-confirmed-lineage",
    });

    key(repaired, 70, "Meta", 11, { metaKey: true });
    key(repaired, 71, "ArrowLeft", 11, { metaKey: true });
    expect(repaired.onSelectionMove({
      at: 72,
      before: cursor(11),
      after: cursor(5),
      origin: "select",
      textBeforeCursor: "xxxxxxxxxx이",
    })).toBe(true);
    expect(repaired.getDebugSnapshot().movedGuard?.guardConfidence)
      .toBe("single-confirmed-lineage");

    key(repaired, 80, "ㅂ", 5);
    beforeInsert(repaired, 81, "입");
    expect(repaired.evaluate(tx(82, 5, 5, "입", "", cursor(5))))
      .toMatchObject({ kind: "atomic-repair", insert: "ㅂ" });
  });

  it("preserves fresh-key evidence when an unconnected ㅇ supersedes a prior moved guard", () => {
    expect(IPADOS_V011_REGRESSIONS.singleRewritePaths.priorMovedFallback[0])
      .toBe("moved-guard:active");
    const machine = new KoreanPseudoCompositionStateMachine();
    seedProvenSa(machine, 10);
    expect(machine.onSelectionMove({
      at: 40,
      before: cursor(11),
      after: cursor(5),
      origin: "select",
      textBeforeCursor: "xxxxxxxxxx사",
    })).toBe(true);

    key(machine, 50, "ㅇ", 5);
    beforeInsert(machine, 51, "ㅇ");
    expect(machine.evaluate(tx(52, 5, 5, "ㅇ", "", cursor(5))))
      .toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
      lastText: "ㅇ",
      rewriteCount: 0,
      guardConfidence: null,
    });

    key(machine, 60, "ㅣ", 6);
    beforeDelete(machine, 61);
    expect(machine.evaluate(tx(62, 5, 6, "", "ㅇ", cursor(6))))
      .toEqual({ kind: "allow" });
    beforeInsert(machine, 63, "이");
    expect(machine.evaluate(tx(64, 5, 5, "이", "", cursor(5))))
      .toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
      lastText: "이",
      rewriteCount: 1,
      guardConfidence: "single-confirmed-lineage",
    });

    key(machine, 70, "Meta", 6, { metaKey: true });
    key(machine, 71, "ArrowLeft", 6, { metaKey: true });
    expect(machine.onSelectionMove({
      at: 72,
      before: cursor(6),
      after: cursor(2),
      origin: "select",
      textBeforeCursor: "xxxxx이",
    })).toBe(true);
    key(machine, 80, "ㅂ", 2);
    beforeInsert(machine, 81, "입");
    expect(machine.evaluate(tx(82, 2, 2, "입", "", cursor(2))))
      .toMatchObject({ kind: "atomic-repair", insert: "ㅂ" });
  });
});
