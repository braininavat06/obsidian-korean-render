import { describe, expect, it } from "vitest";

import type { SelectionSnapshot } from "../src/ime-state-machine";
import {
  KoreanPseudoCompositionStateMachine,
  type AtomicRepairDecision,
  type PseudoTransactionSignal,
} from "../src/pseudo-composition-state-machine";
import { IPADOS_V018_REGRESSIONS } from "./fixtures/ipados-v018-regressions";

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

function normalRewrite(
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

function seedMovedGuard(
  machine: KoreanPseudoCompositionStateMachine,
  source: string,
  sourcePosition: number,
  destination: number,
): void {
  initial(machine, 0, sourcePosition, "ㄹ");
  normalRewrite(machine, 10, sourcePosition, "ㄹ", source, "ㅏ");
  normalRewrite(machine, 20, sourcePosition, source, "락", "ㄱ");
  normalRewrite(machine, 30, sourcePosition, "락", source, "ㅏ");
  expect(machine.onSelectionMove({
    at: 40,
    before: cursor(sourcePosition + source.length),
    after: cursor(destination),
    origin: "select",
    textBeforeCursor: `${"x".repeat(sourcePosition)}${source}`,
  })).toBe(true);
}

function movedRepair(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  position: number,
  inputKey: string,
  deletedText: string,
  nativeText: string,
  deletedRange = { from: position, to: position + deletedText.length },
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

describe("anonymized iPadOS v0.1.8 regressions", () => {
  it("repairs a direct stale moved insertion without a preceding delete", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    const fixture = IPADOS_V018_REGRESSIONS.directMovedInsert;
    seedMovedGuard(machine, fixture.source, 4, 0);

    key(machine, 50, fixture.key, 0);
    beforeInsert(machine, 51, fixture.nativeInsert);
    const decision = machine.evaluate(transaction(52, 0, 0, fixture.nativeInsert, "", cursor(0)));
    expect(decision).toMatchObject({
      kind: "atomic-repair",
      insert: fixture.trustedInsert,
      source: "derived",
      replace: cursor(0),
    });
    if (decision.kind !== "atomic-repair") throw new Error("expected atomic repair");
    machine.commitAtomicRepair(decision);
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      intendedText: fixture.trustedInsert,
      nativeTailText: fixture.nativeInsert,
      nativeState: "repairing",
    });

    const continuation = movedRepair(machine, 60, 1, "ㅏ", "ㄱ", "라가", {
      from: 0,
      to: 1,
    });
    expect(continuation).toMatchObject({ kind: "atomic-repair", insert: "가" });
    expect([decision.insert, continuation.insert].join("")).not.toContain(fixture.nativeInsert);
  });

  it("keeps Backspace rewind state through delete.backward and blocks document spill", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    const fixture = IPADOS_V018_REGRESSIONS.backspaceRewind;
    initial(machine, 0, 3, "ㄱ");
    normalRewrite(machine, 4, 3, "ㄱ", "고", "ㅗ");
    key(machine, 8, "ㅏ", 4);
    beforeDelete(machine, 9);
    expect(machine.evaluate(transaction(10, 3, 4, "", "고", cursor(4))))
      .toEqual({ kind: "allow" });
    beforeInsert(machine, 11, fixture.firstDeleted);
    expect(machine.evaluate(transaction(12, 3, 3, fixture.firstDeleted, "", cursor(3))))
      .toEqual({ kind: "allow" });

    key(machine, 20, "Backspace", 4);
    beforeDelete(machine, 21);
    expect(machine.evaluate(transaction(
      22,
      3,
      4,
      "",
      fixture.firstDeleted,
      cursor(4),
      { userEvent: "delete.backward", selectionAfter: cursor(3) },
    ))).toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("delete-accepted");

    key(machine, 23, "Backspace", 4);
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("delete-accepted");
    machine.onDocumentTransaction("delete.backward", true);
    machine.onAppliedTransaction({
      at: 24,
      userEvent: "delete.backward",
      docChanged: true,
      changeCount: 1,
      from: 3,
      to: 4,
      insert: "",
      selectionBefore: cursor(4),
      selectionAfter: cursor(3),
    });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("delete-accepted");

    beforeInsert(machine, 25, fixture.firstReplacement);
    expect(machine.evaluate(transaction(
      26,
      3,
      3,
      fixture.firstReplacement,
      "",
      cursor(3),
    ))).toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().nativeBackspaceRewind?.phase).toBe("rewrite-completed");

    key(machine, 40, "Backspace", 4);
    beforeDelete(machine, 41);
    expect(machine.evaluate(transaction(
      42,
      3,
      4,
      "",
      fixture.firstReplacement,
      cursor(4),
      { userEvent: "delete.backward", selectionAfter: cursor(3) },
    ))).toEqual({ kind: "allow" });
    key(machine, 43, "Backspace", 4);
    machine.onDocumentTransaction("delete.backward", true);
    machine.onAppliedTransaction({
      at: 44,
      userEvent: "delete.backward",
      docChanged: true,
      changeCount: 1,
      from: 3,
      to: 4,
      insert: "",
      selectionBefore: cursor(4),
      selectionAfter: cursor(3),
    });

    beforeDelete(machine, 45);
    expect(machine.evaluate(transaction(
      46,
      2,
      3,
      "",
      fixture.protectedExistingText.at(-1) ?? "",
      cursor(3),
      { selectionAfter: cursor(2) },
    ))).toMatchObject({
      kind: "suppress-stale-delete",
      deleteSource: "backspace-rewind-spill",
    });
    beforeInsert(machine, 47, fixture.staleReplay);
    expect(machine.evaluate(transaction(
      48,
      3,
      3,
      fixture.staleReplay,
      "",
      cursor(3),
    ))).toMatchObject({ kind: "suppress-stale-replay", insert: fixture.staleReplay });
  });

  it("trusts an observed native continuation after intended and native tail re-synchronize", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    const fixture = IPADOS_V018_REGRESSIONS.synchronizedContinuation;
    seedMovedGuard(machine, "라", 4, 0);

    expect(movedRepair(machine, 50, 0, "ㅎ", "이", "랗")).toMatchObject({ insert: "ㅎ" });
    expect(movedRepair(machine, 60, 1, "ㅗ", "ㅎ", "라호", { from: 0, to: 1 }))
      .toMatchObject({ insert: fixture.firstSyllable });
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      intendedText: fixture.firstSyllable,
      nativeTailText: fixture.firstSyllable,
      nativeState: "repairing",
    });

    const result = movedRepair(
      machine,
      70,
      1,
      fixture.key,
      fixture.firstSyllable,
      fixture.nativeReplacement,
      { from: 0, to: 1 },
    );
    expect(result).toMatchObject({
      insert: fixture.nativeReplacement,
      source: "native-rewrite",
      replace: { from: 0, to: 1 },
    });
    expect(result.insert).not.toBe(`${fixture.firstSyllable}${fixture.key}`);
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      intendedText: fixture.nativeReplacement,
      nativeState: "synchronized",
    });
  });

  it("continues the synchronized native trace to 화려강산", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    seedMovedGuard(machine, "라", 4, 0);
    movedRepair(machine, 50, 0, "ㅎ", "이", "랗");
    movedRepair(machine, 60, 1, "ㅗ", "ㅎ", "라호", { from: 0, to: 1 });
    movedRepair(machine, 70, 1, "ㅏ", "호", "화", { from: 0, to: 1 });
    expect(movedRepair(machine, 80, 1, "ㄹ", "화", "활", { from: 0, to: 1 }).insert)
      .toBe("활");
    expect(movedRepair(machine, 90, 1, "ㅕ", "활", "화려", { from: 0, to: 1 }).insert)
      .toBe("화려");
    expect(movedRepair(machine, 100, 2, "ㄱ", "려", "력", { from: 1, to: 2 }).insert)
      .toBe("력");
    expect(movedRepair(machine, 110, 2, "ㅏ", "력", "려가", { from: 1, to: 2 }).insert)
      .toBe("려가");
    expect(movedRepair(machine, 120, 3, "ㅇ", "가", "강", { from: 2, to: 3 }).insert)
      .toBe("강");
    expect(machine.getDebugSnapshot().movedGuard?.intendedText).toBe("화려강");

    key(machine, 130, "ㅅ", 3);
    beforeInsert(machine, 131, "ㅅ");
    expect(machine.evaluate(transaction(132, 3, 3, "ㅅ", "", cursor(3))))
      .toEqual({ kind: "allow" });
    normalRewrite(machine, 140, 3, "ㅅ", "사", "ㅏ");
    normalRewrite(machine, 150, 3, "사", "산", "ㄴ");
    expect(`화려강${machine.getDebugSnapshot().pseudoComposition.lastText}`)
      .toBe(IPADOS_V018_REGRESSIONS.synchronizedContinuation.expectedPhrase);
  });
});
