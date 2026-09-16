import { describe, expect, it } from "vitest";

import type { SelectionSnapshot } from "../src/ime-state-machine";
import {
  KoreanPseudoCompositionStateMachine,
  POST_DELETE_REPLAY_GUARD_MS,
  type AtomicRepairDecision,
  type PseudoTransactionSignal,
} from "../src/pseudo-composition-state-machine";
import {
  IPADOS_V015_POST_DELETE_NOOP_REPLAY,
  IPADOS_V015_SHIFTED_NATIVE_TAIL,
} from "./fixtures/ipados-v015-regressions";

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
  selection: SelectionSnapshot,
): void {
  machine.onKeyDown({ at, key: value, isComposing: false }, selection);
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
  inputType = "insertText",
): void {
  machine.onBeforeInput({ at, data, inputType, isComposing: false });
}

function apply(document: string, decision: AtomicRepairDecision): string {
  return document.slice(0, decision.replace.from) + decision.insert + document.slice(decision.replace.to);
}

function seedGanadaraAt(machine: KoreanPseudoCompositionStateMachine, offset: number): string {
  let document = "x".repeat(offset);
  key(machine, 0, "ㄱ", cursor(offset));
  beforeInsert(machine, 1, "ㄱ");
  expect(machine.evaluate(transaction(2, offset, offset, "ㄱ", "", cursor(offset)))).toEqual({ kind: "allow" });
  document += "ㄱ";

  const rewrites = [
    ["ㅏ", 0, "ㄱ", "가"],
    ["ㄴ", 0, "가", "간"],
    ["ㅏ", 0, "간", "가나"],
    ["ㄷ", 1, "나", "낟"],
    ["ㅏ", 1, "낟", "나다"],
    ["ㄹ", 2, "다", "달"],
    ["ㅏ", 2, "달", "다라"],
  ] as const;
  let now = 10;
  for (const [pressed, relativeFrom, previous, inserted] of rewrites) {
    const from = offset + relativeFrom;
    key(machine, now, pressed, cursor(from + previous.length));
    beforeDelete(machine, now + 1);
    expect(
      machine.evaluate(
        transaction(now + 2, from, from + previous.length, "", previous, cursor(from + previous.length)),
      ),
    ).toEqual({ kind: "allow" });
    document = document.slice(0, from) + document.slice(from + previous.length);
    beforeInsert(machine, now + 3, inserted);
    expect(machine.evaluate(transaction(now + 4, from, from, inserted, "", cursor(from)))).toEqual({ kind: "allow" });
    document = document.slice(0, from) + inserted + document.slice(from);
    now += 10;
  }
  return document;
}

function activeShiftedSession(): {
  machine: KoreanPseudoCompositionStateMachine;
  document: string;
  position: number;
} {
  const machine = new KoreanPseudoCompositionStateMachine();
  let document = seedGanadaraAt(machine, 49);
  let position = document.length;
  for (const next of [52, 51]) {
    expect(machine.onSelectionMove({
      at: 100 + next,
      before: cursor(position),
      after: cursor(next),
      origin: "select",
      textBeforeCursor: document.slice(0, position),
    })).toBe(true);
    position = next;
  }

  const steps = [
    ["ㄱ", "락", "ㄱ"],
    ["ㅏ", "라가", "가"],
    ["ㄴ", "간", "간"],
    ["ㅏ", "가나", "가나"],
    ["ㄷ", "낟", "낟"],
    ["ㅏ", "나다", "나다"],
  ] as const;
  let now = 200;
  for (const [pressed, nativeData, expectedIntended] of steps) {
    key(machine, now, pressed, cursor(position));
    beforeDelete(machine, now + 1);
    const deletedFrom = position - 1;
    const deletedText = document.slice(deletedFrom, position);
    expect(
      machine.evaluate(
        transaction(now + 2, deletedFrom, position, "", deletedText, cursor(position)),
      ).kind,
    ).toBe("suppress-stale-delete");
    beforeInsert(machine, now + 3, nativeData);
    const decision = machine.evaluate(
      transaction(now + 4, position, position, nativeData, "", cursor(position)),
    );
    expect(decision).toMatchObject({ kind: "atomic-repair", insert: expectedIntended });
    if (decision.kind !== "atomic-repair") throw new Error("expected atomic repair");
    document = apply(document, decision);
    machine.commitAtomicRepair(decision);
    position = decision.replace.from + decision.insert.length;
    now += 10;
  }

  expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
    protectedSourceRange: IPADOS_V015_SHIFTED_NATIVE_TAIL.protectedSourceRange,
    protectedSourceText: IPADOS_V015_SHIFTED_NATIVE_TAIL.protectedSourceText,
    nativeTailRange: IPADOS_V015_SHIFTED_NATIVE_TAIL.nativeTailRange,
    nativeTailText: IPADOS_V015_SHIFTED_NATIVE_TAIL.nativeTailText,
    intendedRange: IPADOS_V015_SHIFTED_NATIVE_TAIL.intendedRange,
    intendedText: IPADOS_V015_SHIFTED_NATIVE_TAIL.intendedText,
    destination: cursor(IPADOS_V015_SHIFTED_NATIVE_TAIL.selection),
  });
  return { machine, document, position };
}

function shiftedDelete(
  machine: KoreanPseudoCompositionStateMachine,
  at = 300,
  overrides: Partial<PseudoTransactionSignal> = {},
) {
  const fixture = IPADOS_V015_SHIFTED_NATIVE_TAIL;
  key(machine, at, fixture.continuationKey, cursor(fixture.selection));
  beforeDelete(machine, at + 1);
  return machine.evaluate(
    transaction(
      at + 2,
      fixture.attemptedDeleteRange.from,
      fixture.attemptedDeleteRange.to,
      "",
      fixture.deletedText,
      cursor(fixture.selection),
      overrides,
    ),
  );
}

function armReplayGuard(machine: KoreanPseudoCompositionStateMachine): void {
  const fixture = IPADOS_V015_POST_DELETE_NOOP_REPLAY;
  const selection = { from: 0, to: fixture.selectedDocument.length };
  key(machine, fixture.armAt - 2, "Backspace", selection);
  beforeDelete(machine, fixture.armAt - 1);
  machine.onDocumentTransaction(fixture.deleteUserEvent, true);
  machine.onAppliedTransaction({
    at: fixture.armAt,
    userEvent: fixture.deleteUserEvent,
    docChanged: true,
    changeCount: 1,
    from: selection.from,
    to: selection.to,
    insert: "",
    selectionBefore: selection,
    selectionAfter: cursor(0),
  });
}

describe("anonymized iPadOS v0.1.5 regression traces", () => {
  it("A/B: suppresses a proven shifted native-tail delete and preserves the moved lineage", () => {
    const { machine, document } = activeShiftedSession();
    const decision = shiftedDelete(machine);
    expect(decision).toEqual({
      kind: "suppress-stale-delete",
      originalText: "다",
      range: { from: 54, to: 55 },
      repairRange: { from: 53, to: 54 },
      staleText: "다",
      deleteSource: "shifted-native-tail",
    });
    expect(document.slice(54, 55)).toBe("다");
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      protectedSourceRange: { from: 55, to: 56 },
      protectedSourceText: "라",
      nativeTailRange: { from: 54, to: 55 },
      intendedRange: { from: 51, to: 54 },
      intendedText: "가나다",
    });

    beforeInsert(machine, 303, "달");
    const continuation = machine.evaluate(transaction(304, 54, 54, "달", "", cursor(54)));
    expect(continuation).toMatchObject({
      kind: "atomic-repair",
      insert: "달",
      replace: { from: 53, to: 54 },
      source: "native-rewrite",
    });
    if (continuation.kind !== "atomic-repair") throw new Error("expected native continuation");
    machine.commitAtomicRepair(continuation);
    expect(machine.getDebugSnapshot().movedGuard?.intendedText).toBe("가나달");
    expect(machine.onSelectionMove({
      at: 310,
      before: cursor(54),
      after: cursor(53),
      origin: "select",
      textBeforeCursor: document.slice(0, 54),
    })).toBe(true);
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      destination: cursor(53),
      intendedRange: null,
      intendedText: "",
    });
  });

  it("C: does not intercept an adjacent equal character without active moved lineage", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    expect(shiftedDelete(machine).kind).toBe("allow");
  });

  it("D: does not intercept a delete outside the exact adjacent range", () => {
    const { machine } = activeShiftedSession();
    expect(shiftedDelete(machine, 300, { from: 55, to: 56 }).kind).toBe("allow");
  });

  it("E: does not intercept when deleted text differs from nativeTailText", () => {
    const { machine } = activeShiftedSession();
    expect(shiftedDelete(machine, 300, { deletedText: "라" }).kind).toBe("allow");
  });

  it("F: preserves the guard across the trailing no-op and suppresses stale 간", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    const fixture = IPADOS_V015_POST_DELETE_NOOP_REPLAY;
    armReplayGuard(machine);
    expect(POST_DELETE_REPLAY_GUARD_MS).toBe(40);
    beforeDelete(machine, fixture.noopAt - 1);
    expect(machine.evaluate(transaction(
      fixture.noopAt,
      -1,
      -1,
      "",
      "",
      cursor(0),
      { changeCount: 0, docChanged: false },
    ))).toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().pendingPostDeleteReplayGuard).not.toBeNull();
    const preserved = machine.drainDiagnostics().find(
      (diagnostic) => diagnostic.eventType === "post-delete-noop-preserved",
    );
    expect(preserved?.details["reason"]).toBe("same-deleteContentBackward-burst");

    beforeInsert(machine, fixture.replayAt, fixture.replayData);
    expect(machine.evaluate(transaction(
      fixture.replayAt + 1,
      0,
      0,
      fixture.replayData,
      "",
      cursor(0),
    ))).toMatchObject({ kind: "suppress-stale-replay", insert: "간" });
    expect(machine.getDebugSnapshot().pendingPostDeleteReplayGuard).toBeNull();
  });

  it("G: disarms on a zero-change transaction whose selection changes", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    const fixture = IPADOS_V015_POST_DELETE_NOOP_REPLAY;
    armReplayGuard(machine);
    machine.drainDiagnostics();
    beforeDelete(machine, fixture.noopAt - 1);
    machine.evaluate(transaction(fixture.noopAt, -1, -1, "", "", cursor(0), {
      changeCount: 0,
      docChanged: false,
      selectionAfter: cursor(1),
    }));
    expect(machine.getDebugSnapshot().pendingPostDeleteReplayGuard).toBeNull();
    const disarmed = machine.drainDiagnostics().find(
      (diagnostic) => diagnostic.eventType === "post-delete-guard-disarmed",
    );
    expect(disarmed?.details["reason"]).toBe("zero-change-selection-change");
  });

  it("H: disarms on a real multi-change document transaction", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    const fixture = IPADOS_V015_POST_DELETE_NOOP_REPLAY;
    armReplayGuard(machine);
    machine.drainDiagnostics();
    machine.evaluate(transaction(fixture.noopAt, 0, 1, "x", "a", cursor(0), {
      changeCount: 2,
      docChanged: true,
    }));
    const disarmed = machine.drainDiagnostics().find(
      (diagnostic) => diagnostic.eventType === "post-delete-guard-disarmed",
    );
    expect(disarmed?.details["reason"]).toBe("multi-change-document-transaction");
  });

  it("I: disarms on a real Korean keydown and allows its input", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    const fixture = IPADOS_V015_POST_DELETE_NOOP_REPLAY;
    armReplayGuard(machine);
    key(machine, fixture.noopAt, "ㄱ", cursor(0));
    beforeInsert(machine, fixture.noopAt + 1, "ㄱ");
    expect(machine.evaluate(transaction(
      fixture.noopAt + 2,
      0,
      0,
      "ㄱ",
      "",
      cursor(0),
    ))).toEqual({ kind: "allow" });
  });

  it.each([
    ["paste", (machine: KoreanPseudoCompositionStateMachine) => beforeInsert(machine, 35_643, "간", "insertFromPaste")],
    ["composition", (machine: KoreanPseudoCompositionStateMachine) => machine.onRealCompositionEvent()],
    ["undo", (machine: KoreanPseudoCompositionStateMachine) => machine.onDocumentTransaction("undo", true)],
    ["redo", (machine: KoreanPseudoCompositionStateMachine) => machine.onDocumentTransaction("redo", true)],
  ])("J: disarms on %s", (_name, terminate) => {
    const machine = new KoreanPseudoCompositionStateMachine();
    armReplayGuard(machine);
    terminate(machine);
    expect(machine.getDebugSnapshot().pendingPostDeleteReplayGuard).toBeNull();
  });
});
