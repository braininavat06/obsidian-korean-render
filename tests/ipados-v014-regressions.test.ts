import { describe, expect, it } from "vitest";

import type { SelectionSnapshot } from "../src/ime-state-machine";
import {
  KoreanPseudoCompositionStateMachine,
  POST_DELETE_REPLAY_GUARD_MS,
  type AtomicRepairDecision,
  type PseudoTransactionSignal,
} from "../src/pseudo-composition-state-machine";
import {
  IPADOS_V014_NATIVE_TAIL_REGRESSION,
  IPADOS_V014_POST_DELETE_REPLAY,
} from "./fixtures/ipados-v014-regressions";

const cursor = (position: number): SelectionSnapshot => ({ from: position, to: position });

function transaction(
  at: number,
  from: number,
  to: number,
  insert: string,
  deletedText: string,
  position: number,
  userEvent = "input.type",
): PseudoTransactionSignal {
  return {
    at,
    from,
    to,
    insert,
    deletedText,
    changeCount: 1,
    docChanged: true,
    userEvent,
    selectionBefore: cursor(position),
    selectionAfter: cursor(position),
    sourceStillPresent: true,
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

function seedGanadara(machine: KoreanPseudoCompositionStateMachine): string {
  let document = "";
  let now = 0;
  key(machine, now, "ㄱ", cursor(0));
  beforeInsert(machine, now + 1, "ㄱ");
  expect(machine.evaluate(transaction(now + 2, 0, 0, "ㄱ", "", 0))).toEqual({ kind: "allow" });
  document = "ㄱ";

  const rewrites = [
    ["ㅏ", 0, "ㄱ", "가"],
    ["ㄴ", 0, "가", "간"],
    ["ㅏ", 0, "간", "가나"],
    ["ㄷ", 1, "나", "낟"],
    ["ㅏ", 1, "낟", "나다"],
    ["ㄹ", 2, "다", "달"],
    ["ㅏ", 2, "달", "다라"],
  ] as const;

  for (const [pressed, from, previous, inserted] of rewrites) {
    now += 10;
    key(machine, now, pressed, cursor(from + previous.length));
    beforeDelete(machine, now + 1);
    expect(
      machine.evaluate(
        transaction(now + 2, from, from + previous.length, "", previous, from + previous.length),
      ),
    ).toEqual({ kind: "allow" });
    document = document.slice(0, from) + document.slice(from + previous.length);
    beforeInsert(machine, now + 3, inserted);
    expect(machine.evaluate(transaction(now + 4, from, from, inserted, "", from))).toEqual({ kind: "allow" });
    document = document.slice(0, from) + inserted + document.slice(from);
  }
  expect(document).toBe(IPADOS_V014_NATIVE_TAIL_REGRESSION.initialDocument);
  return document;
}

function moveAlong(
  machine: KoreanPseudoCompositionStateMachine,
  document: string,
  from: number,
  path: readonly number[],
  startAt: number,
): number {
  let position = from;
  let now = startAt;
  for (const destination of path) {
    expect(machine.onSelectionMove({
      at: now++,
      before: cursor(position),
      after: cursor(destination),
      origin: "select",
      textBeforeCursor: document.slice(0, position),
    })).toBe(true);
    position = destination;
  }
  return position;
}

function replayRepair(
  machine: KoreanPseudoCompositionStateMachine,
  document: string,
  position: number,
  steps: readonly { key: string; nativeData: string; expected: string }[],
  startAt: number,
): { document: string; position: number } {
  let now = startAt;
  for (const step of steps) {
    key(machine, now, step.key, cursor(position));
    beforeDelete(machine, now + 1);
    const deletedFrom = position - 1;
    const deletedText = document.slice(deletedFrom, position);
    expect(machine.evaluate(transaction(now + 2, deletedFrom, position, "", deletedText, position))).toMatchObject({
      kind: "suppress-stale-delete",
      originalText: deletedText,
    });
    beforeInsert(machine, now + 3, step.nativeData);
    const decision = machine.evaluate(transaction(now + 4, position, position, step.nativeData, "", position));
    expect(decision).toMatchObject({ kind: "atomic-repair", insert: step.expected });
    if (decision.kind !== "atomic-repair") throw new Error("expected atomic repair");
    document = apply(document, decision);
    machine.commitAtomicRepair(decision);
    position = decision.replace.from + decision.insert.length;
    now += 10;
  }
  return { document, position };
}

function armPostDeleteGuard(
  machine: KoreanPseudoCompositionStateMachine,
  document: string,
  at = 100,
): void {
  const selection = { from: 0, to: document.length };
  key(machine, at, IPADOS_V014_POST_DELETE_REPLAY.key, selection);
  machine.onDocumentTransaction(IPADOS_V014_POST_DELETE_REPLAY.transactionUserEvent, true);
  machine.onAppliedTransaction({
    at: at + 10,
    userEvent: IPADOS_V014_POST_DELETE_REPLAY.transactionUserEvent,
    docChanged: true,
    changeCount: 1,
    from: selection.from,
    to: selection.to,
    insert: "",
    selectionBefore: selection,
    selectionAfter: cursor(0),
  });
}

describe("anonymized iPadOS v0.1.4 regression traces", () => {
  it("A: follows the second-move native 나 → 낙 → 나가 → 간 → 가나 lineage", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    let document = seedGanadara(machine);
    let position = moveAlong(machine, document, document.length, IPADOS_V014_NATIVE_TAIL_REGRESSION.firstMovePath, 100);
    ({ document, position } = replayRepair(machine, document, position, IPADOS_V014_NATIVE_TAIL_REGRESSION.firstRepair, 120));
    expect(document).toBe("가나가나다라");
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      protectedSourceRange: { from: 5, to: 6 },
      protectedSourceText: "라",
      nativeTailRange: { from: 3, to: 4 },
      nativeTailText: "나",
      intendedRange: { from: 2, to: 4 },
      intendedText: "가나",
    });

    position = moveAlong(machine, document, position, IPADOS_V014_NATIVE_TAIL_REGRESSION.secondMovePath, 200);
    ({ document } = replayRepair(machine, document, position, IPADOS_V014_NATIVE_TAIL_REGRESSION.secondRepair, 220));
    expect(document).toBe("가나가나가나다라");
    expect(document).not.toContain("ㄱ가나");
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      protectedSourceRange: { from: 7, to: 8 },
      protectedSourceText: "라",
      nativeTailRange: { from: 3, to: 4 },
      nativeTailText: "나",
      intendedRange: { from: 2, to: 4 },
      intendedText: "가나",
    });
  });

  it("B: promotes native 간 over the entire pending ㄱㅏ sequence", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedGanadara(machine);
    moveAlong(machine, "가나다라", 4, [3, 2], 100);

    key(machine, 110, "ㄱ", cursor(2));
    beforeDelete(machine, 111);
    expect(machine.evaluate(transaction(112, 1, 2, "", "나", 2)).kind).toBe("suppress-stale-delete");
    beforeInsert(machine, 113, "마");
    const first = machine.evaluate(transaction(114, 2, 2, "마", "", 2));
    if (first.kind !== "atomic-repair") throw new Error("expected first repair");
    machine.commitAtomicRepair(first);

    key(machine, 120, "ㅏ", cursor(3));
    beforeDelete(machine, 121);
    expect(machine.evaluate(transaction(122, 2, 3, "", "ㄱ", 3)).kind).toBe("suppress-stale-delete");
    beforeInsert(machine, 123, "버");
    const second = machine.evaluate(transaction(124, 3, 3, "버", "", 3));
    expect(second).toMatchObject({ kind: "atomic-repair", insert: "ㅏ", source: "pending-intended-key" });
    if (second.kind !== "atomic-repair") throw new Error("expected second repair");
    machine.commitAtomicRepair(second);
    expect(machine.getDebugSnapshot().movedGuard?.intendedText).toBe("ㄱㅏ");

    key(machine, 130, "ㄴ", cursor(4));
    beforeDelete(machine, 131);
    expect(machine.evaluate(transaction(132, 3, 4, "", "ㅏ", 4)).kind).toBe("suppress-stale-delete");
    beforeInsert(machine, 133, "간");
    const third = machine.evaluate(transaction(134, 4, 4, "간", "", 4));
    expect(third).toMatchObject({
      kind: "atomic-repair",
      insert: "간",
      replace: { from: 2, to: 4 },
      source: "native-rewrite",
    });
    if (third.kind !== "atomic-repair") throw new Error("expected third repair");
    machine.commitAtomicRepair(third);
    expect(machine.getDebugSnapshot().movedGuard?.intendedText).toBe("간");
    expect(machine.getDebugSnapshot().movedGuard?.intendedText).not.toBe("ㄱ간");
  });

  it("C: suppresses the measured 10ms Hangul replay after physical range deletion", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    armPostDeleteGuard(machine, IPADOS_V014_POST_DELETE_REPLAY.selectedDocument);
    expect(machine.getDebugSnapshot().pendingPostDeleteReplayGuard).toMatchObject({
      armReason: "physical-backspace-delete.selection",
      destination: cursor(0),
    });
    const armed = machine.drainDiagnostics().find(
      (diagnostic) => diagnostic.eventType === "post-delete-replay-guard-armed",
    );
    expect(armed?.details["reason"]).toBe("physical-backspace-delete.selection");
    beforeInsert(machine, 120, IPADOS_V014_POST_DELETE_REPLAY.replayData);
    expect(machine.evaluate(transaction(121, 0, 0, "간", "", 0))).toMatchObject({
      kind: "suppress-stale-replay",
      insert: "간",
    });
    expect(machine.getDebugSnapshot().pendingPostDeleteReplayGuard).toBeNull();
    const suppressed = machine.drainDiagnostics().find(
      (diagnostic) => diagnostic.eventType === "post-delete-guard-disarmed",
    );
    expect(suppressed?.details["reason"]).toBe("suppressed-one-shot");
  });

  it("D: allows normal Korean input after a new physical Korean keydown", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    armPostDeleteGuard(machine, IPADOS_V014_POST_DELETE_REPLAY.selectedDocument);
    machine.drainDiagnostics();
    key(machine, 120, "ㄱ", cursor(0));
    const disarmed = machine.drainDiagnostics().find(
      (diagnostic) => diagnostic.eventType === "post-delete-guard-disarmed",
    );
    expect(disarmed?.details["reason"]).toBe("korean-keydown");
    beforeInsert(machine, 121, "ㄱ");
    expect(machine.evaluate(transaction(122, 0, 0, "ㄱ", "", 0))).toEqual({ kind: "allow" });
  });

  it("E: allows unrelated Hangul insertion after the 40ms guard timeout", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    armPostDeleteGuard(machine, IPADOS_V014_POST_DELETE_REPLAY.selectedDocument);
    expect(POST_DELETE_REPLAY_GUARD_MS).toBe(40);
    beforeInsert(machine, 310, "간");
    expect(machine.evaluate(transaction(311, 0, 0, "간", "", 0))).toEqual({ kind: "allow" });
  });

  it("F: never treats paste after range deletion as stale replay", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    armPostDeleteGuard(machine, IPADOS_V014_POST_DELETE_REPLAY.selectedDocument);
    beforeInsert(machine, 120, "간", "insertFromPaste");
    expect(machine.evaluate(transaction(121, 0, 0, "간", "", 0, "input.paste"))).toEqual({ kind: "allow" });
  });

  it.each(["undo", "redo"])("G: disarms before %s", (userEvent) => {
    const machine = new KoreanPseudoCompositionStateMachine();
    armPostDeleteGuard(machine, IPADOS_V014_POST_DELETE_REPLAY.selectedDocument);
    machine.onDocumentTransaction(userEvent, true);
    beforeInsert(machine, 120, "간");
    expect(machine.evaluate(transaction(121, 0, 0, "간", "", 0))).toEqual({ kind: "allow" });
  });

  it.each([" ", "Enter", "a", "7", "!"])("disarms the replay guard on boundary key %s", (value) => {
    const machine = new KoreanPseudoCompositionStateMachine();
    armPostDeleteGuard(machine, IPADOS_V014_POST_DELETE_REPLAY.selectedDocument);
    key(machine, 120, value, cursor(0));
    expect(machine.getDebugSnapshot().pendingPostDeleteReplayGuard).toBeNull();
  });

  it("disarms the replay guard on selection, composition, blur, and other document changes", () => {
    const cases: Array<(machine: KoreanPseudoCompositionStateMachine) => void> = [
      (machine) => {
        machine.onSelectionMove({
          at: 120,
          before: cursor(0),
          after: cursor(1),
          origin: "select.pointer",
          textBeforeCursor: "",
        });
      },
      (machine) => machine.onRealCompositionEvent(),
      (machine) => machine.onExternalFocusBoundary(),
      (machine) => machine.onDocumentTransaction("input.type", true),
    ];
    for (const terminate of cases) {
      const machine = new KoreanPseudoCompositionStateMachine();
      armPostDeleteGuard(machine, IPADOS_V014_POST_DELETE_REPLAY.selectedDocument);
      terminate(machine);
      expect(machine.getDebugSnapshot().pendingPostDeleteReplayGuard).toBeNull();
    }
  });
});
