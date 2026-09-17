import { describe, expect, it } from "vitest";

import type { SelectionSnapshot } from "../src/ime-state-machine";
import {
  KoreanPseudoCompositionStateMachine,
  type AtomicRepairDecision,
  type PseudoTransactionSignal,
} from "../src/pseudo-composition-state-machine";
import { IPADOS_V017_LIFECYCLE } from "./fixtures/ipados-v017-lifecycle";

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
    selectionAfter: selectionBefore,
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
  machine.onKeyDown({ at, key: value, isComposing: false }, cursor(position));
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
  key(machine, at, inputKey, position + 1);
  beforeDelete(machine, at + 1);
  expect(machine.evaluate(transaction(
    at + 2,
    position,
    position + 1,
    "",
    previous,
    cursor(position + 1),
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

function movedRepair(machine: KoreanPseudoCompositionStateMachine): void {
  initial(machine, 0, 10, "ㅅ");
  rewrite(machine, 10, 10, "ㅅ", "세", "ㅔ");
  rewrite(machine, 20, 10, "세", "셋", "ㅅ");
  expect(machine.onSelectionMove({
    at: 30,
    before: cursor(11),
    after: cursor(5),
    origin: "select",
    textBeforeCursor: `${"x".repeat(10)}셋`,
  })).toBe(true);
}

function repair(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  position: number,
  inputKey: string,
  deletedText: string,
  nativeText: string,
  deletedRange = { from: position - 1, to: position },
): AtomicRepairDecision {
  key(machine, at, inputKey, position);
  beforeDelete(machine, at + 1);
  expect(machine.evaluate(transaction(
    at + 2,
    deletedRange.from,
    deletedRange.to,
    "",
    deletedText,
    cursor(position),
  ))).toMatchObject({ kind: "suppress-stale-delete" });
  beforeInsert(machine, at + 3, nativeText);
  const decision = machine.evaluate(transaction(
    at + 4,
    position,
    position,
    nativeText,
    "",
    cursor(position),
  ));
  expect(decision.kind).toBe("atomic-repair");
  if (decision.kind !== "atomic-repair") throw new Error("expected atomic repair");
  machine.commitAtomicRepair(decision);
  return decision;
}

describe("anonymized iPadOS v0.1.7 lifecycle regressions", () => {
  it("hands a Jamo started inside moved repair to a confirmed single-rewrite lineage", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    movedRepair(machine);

    expect(repair(machine, 40, 5, "ㅅ", "이", "셋ㅅ", { from: 5, to: 6 })).toMatchObject({
      insert: "ㅅ",
    });
    expect(repair(machine, 50, 6, "ㅔ", "ㅅ", "세")).toMatchObject({
      insert: "세",
      source: "native-rewrite",
    });
    expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
      rewriteCount: 1,
      guardConfidence: "single-confirmed-lineage",
      lastText: "세",
    });

    expect(machine.onSelectionMove({
      at: 60,
      before: cursor(6),
      after: cursor(4),
      origin: "select",
      textBeforeCursor: "xxxx세",
    })).toBe(true);
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      protectedSourceText: "세",
      guardConfidence: "single-confirmed-lineage",
      destination: cursor(4),
    });

    const result = repair(machine, 70, 4, "ㅁ", "가", "셈", { from: 4, to: 5 });
    expect(result).toMatchObject({ insert: "ㅁ" });
    const continuation = repair(machine, 80, 5, "ㅡ", "ㅁ", "세므");
    expect(continuation).toMatchObject({ insert: "므", source: "derived" });
    expect([result.insert, continuation.insert]).not.toContain(
      IPADOS_V017_LIFECYCLE.handoff.staleResults[1],
    );
  });

  it("preserves the clean-session single-confirmed-lineage path", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    initial(machine, 0, 0, "ㅅ");
    rewrite(machine, 10, 0, "ㅅ", "세", "ㅔ");
    expect(machine.getDebugSnapshot().pseudoComposition.guardConfidence).toBe(
      "single-confirmed-lineage",
    );
  });

  it("allows one connected Backspace rewind, then blocks spill past that syllable", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    initial(machine, 0, 1, "ㅂ");
    rewrite(machine, 10, 1, "ㅂ", "버", "ㅓ");
    rewrite(machine, 20, 1, "버", "벗", "ㅅ");

    key(machine, 30, "Backspace", 2);
    beforeDelete(machine, 31);
    expect(machine.evaluate(transaction(32, 1, 2, "", "벗", cursor(2))))
      .toEqual({ kind: "allow" });
    machine.onDocumentTransaction("input.type", true);
    machine.onAppliedTransaction({
      at: 33,
      userEvent: "input.type",
      docChanged: true,
      changeCount: 1,
      from: 1,
      to: 2,
      insert: "",
      selectionBefore: cursor(2),
      selectionAfter: cursor(1),
    });

    beforeInsert(machine, 34, "버");
    expect(machine.evaluate(transaction(35, 1, 1, "버", "", cursor(1))))
      .toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("rewrite-completed");

    beforeDelete(machine, 36);
    expect(machine.evaluate(transaction(37, 0, 1, "", "앞", cursor(1))))
      .toMatchObject({
        kind: "suppress-stale-delete",
        deleteSource: "backspace-rewind-spill",
      });
    beforeInsert(machine, 38, "멉");
    expect(machine.evaluate(transaction(39, 0, 0, "멉", "", cursor(0))))
      .toMatchObject({ kind: "suppress-stale-replay", insert: "멉" });
  });

  it("transfers a moved atomic-repair session into Backspace rewind protection", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    movedRepair(machine);
    expect(repair(machine, 40, 5, "ㅂ", "이", "셋ㅂ")).toMatchObject({ insert: "ㅂ" });
    expect(repair(machine, 50, 6, "ㅓ", "ㅂ", "버")).toMatchObject({ insert: "버" });
    expect(repair(machine, 60, 6, "ㅅ", "버", "벗")).toMatchObject({ insert: "벗" });

    key(machine, 70, "Backspace", 6);
    beforeDelete(machine, 71);
    expect(machine.evaluate(transaction(72, 5, 6, "", "벗", cursor(6))))
      .toEqual({ kind: "allow" });
    machine.onDocumentTransaction("input.type", true);
    machine.onAppliedTransaction({
      at: 73,
      userEvent: "input.type",
      docChanged: true,
      changeCount: 1,
      from: 5,
      to: 6,
      insert: "",
      selectionBefore: cursor(6),
      selectionAfter: cursor(5),
    });
    beforeInsert(machine, 74, "버");
    expect(machine.evaluate(transaction(75, 5, 5, "버", "", cursor(5))))
      .toEqual({ kind: "allow" });

    beforeDelete(machine, 76);
    expect(machine.evaluate(transaction(77, 4, 5, "", "앞", cursor(5))))
      .toMatchObject({ kind: "suppress-stale-delete" });
    beforeInsert(machine, 78, "멉");
    expect(machine.evaluate(transaction(79, 4, 4, "멉", "", cursor(4))))
      .toMatchObject({ kind: "suppress-stale-replay" });
  });

  it("does not alter ordinary Backspace without tracked pseudo/native state", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    key(machine, 10, "Backspace", 4);
    beforeDelete(machine, 11);
    expect(machine.evaluate(transaction(
      12,
      3,
      4,
      "",
      "a",
      cursor(4),
      { userEvent: "delete.backward" },
    ))).toEqual({ kind: "allow" });
  });

  it("ends rewind protection on a real new Korean key and allows that input", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    initial(machine, 0, 1, "ㅂ");
    rewrite(machine, 10, 1, "ㅂ", "버", "ㅓ");
    rewrite(machine, 20, 1, "버", "벗", "ㅅ");
    key(machine, 30, "Backspace", 2);
    beforeDelete(machine, 31);
    expect(machine.evaluate(transaction(32, 1, 2, "", "벗", cursor(2))).kind).toBe("allow");
    machine.onDocumentTransaction("input.type", true);
    machine.onAppliedTransaction({
      at: 33,
      userEvent: "input.type",
      docChanged: true,
      changeCount: 1,
      from: 1,
      to: 2,
      insert: "",
      selectionBefore: cursor(2),
      selectionAfter: cursor(1),
    });
    beforeInsert(machine, 34, "버");
    expect(machine.evaluate(transaction(35, 1, 1, "버", "", cursor(1))).kind).toBe("allow");

    key(machine, 50, "ㄱ", 2);
    beforeInsert(machine, 51, "ㄱ");
    expect(machine.evaluate(transaction(52, 2, 2, "ㄱ", "", cursor(2))))
      .toEqual({ kind: "allow" });
  });
});
