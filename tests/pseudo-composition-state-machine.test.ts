import { describe, expect, it } from "vitest";

import type { SelectionSnapshot } from "../src/ime-state-machine";
import {
  KoreanPseudoCompositionStateMachine,
  isConnectedHangulRewrite,
  type PseudoDecision,
  type PseudoTransactionSignal,
} from "../src/pseudo-composition-state-machine";

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

function key(machine: KoreanPseudoCompositionStateMachine, at: number, value: string): void {
  machine.onKeyDown({ at, key: value, isComposing: false });
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

function initialInsert(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  position: number,
  data: string,
): void {
  key(machine, at, Array.from(data)[0] ?? data);
  beforeInsert(machine, at + 1, data);
  expect(
    machine.evaluate(transaction(at + 2, position, position, data, "", cursor(position))),
  ).toEqual({ kind: "allow" });
}

function rewrite(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  range: { from: number; to: number },
  previous: string,
  inserted: string,
  inputKey: string,
): void {
  key(machine, at, inputKey);
  beforeDelete(machine, at + 1);
  expect(
    machine.evaluate(
      transaction(at + 2, range.from, range.to, "", previous, cursor(range.to)),
    ),
  ).toEqual({ kind: "allow" });
  beforeInsert(machine, at + 3, inserted);
  expect(
    machine.evaluate(
      transaction(at + 4, range.from, range.from, inserted, "", cursor(range.from)),
    ),
  ).toEqual({ kind: "allow" });
}

function trainEhyu(machine: KoreanPseudoCompositionStateMachine, start = 7): void {
  initialInsert(machine, 10, start, "ㅇ");
  rewrite(machine, 20, { from: start, to: start + 1 }, "ㅇ", "에", "ㅔ");
  rewrite(machine, 30, { from: start, to: start + 1 }, "에", "엫", "ㅎ");
  rewrite(machine, 40, { from: start, to: start + 1 }, "엫", "에휴", "ㅠ");
}

function move(
  machine: KoreanPseudoCompositionStateMachine,
  at = 60,
  destination = 3,
  origin: "select" | "select.pointer" = "select",
): boolean {
  return machine.onSelectionMove({
    at,
    before: cursor(9),
    after: cursor(destination),
    origin,
    textBeforeCursor: "1234567에휴",
  });
}

function staleDelete(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  destination: number,
  inputKey: string,
  deletedText = "더",
): PseudoDecision {
  key(machine, at, inputKey);
  beforeDelete(machine, at + 1);
  return machine.evaluate(
    transaction(
      at + 2,
      destination - deletedText.length,
      destination,
      "",
      deletedText,
      cursor(destination),
    ),
  );
}

describe("KoreanPseudoCompositionStateMachine", () => {
  it("the first tracked rewrite replaces only text inserted by the IME", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    let document = "ABC";

    initialInsert(machine, 10, 3, "ㄱ");
    document = `${document}ㄱ`;

    key(machine, 20, "ㅏ");
    beforeDelete(machine, 21);
    const deleteDecision = machine.evaluate(
      transaction(22, 3, 4, "", document.slice(3, 4), cursor(4)),
    );
    expect(deleteDecision).toEqual({ kind: "allow" });
    expect(document.slice(3, 4)).toBe("ㄱ");
    expect(document.slice(0, 3)).toBe("ABC");
    document = document.slice(0, 3);

    beforeInsert(machine, 23, "가");
    expect(machine.evaluate(transaction(24, 3, 3, "가", "", cursor(3)))).toEqual({ kind: "allow" });
    document = `${document}가`;

    expect(document).toBe("ABC가");
  });

  it("tracks 가 → 각 → 간 style rewrites without intervening", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    initialInsert(machine, 10, 0, "ㄱ");
    rewrite(machine, 20, { from: 0, to: 1 }, "ㄱ", "가", "ㅏ");
    rewrite(machine, 30, { from: 0, to: 1 }, "가", "각", "ㄱ");
    rewrite(machine, 40, { from: 0, to: 1 }, "각", "간", "ㄴ");

    expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
      active: true,
      lastRange: { from: 0, to: 1 },
      lastText: "간",
      rewriteCount: 3,
    });
  });

  it("does not intervene when Korean input continues at the same position", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    key(machine, 50, "ㅇ");
    beforeInsert(machine, 51, "ㅇ");
    expect(machine.evaluate(transaction(52, 9, 9, "ㅇ", "", cursor(9)))).toEqual({ kind: "allow" });
  });

  it("arms a moved guard after each arrow direction moves outside the pseudo range", () => {
    for (const destination of [8, 10, 2, 15]) {
      const machine = new KoreanPseudoCompositionStateMachine();
      trainEhyu(machine);
      expect(move(machine, 60, destination)).toBe(true);
      expect(machine.getDebugSnapshot().selectionMovedOutsidePseudoRange).toBe(true);
    }
  });

  it("arms the same moved guard for touch selection", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    expect(move(machine, 60, 3, "select.pointer")).toBe(true);
  });

  it("allows a clean first Hangul insertion after movement", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine);
    key(machine, 70, "ㅇ");
    beforeInsert(machine, 71, "ㅇ");
    expect(machine.evaluate(transaction(72, 3, 3, "ㅇ", "", cursor(3)))).toEqual({ kind: "allow" });
    expect(machine.getDebugSnapshot().selectionMovedOutsidePseudoRange).toBe(false);
  });

  it("protects the concrete 휴 → move → delete/흉 → delete/휴이 trace", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine);

    expect(staleDelete(machine, 70, 3, "ㅇ")).toMatchObject({
      kind: "suppress-stale-delete",
      originalText: "더",
      staleText: "휴",
    });
    beforeInsert(machine, 73, "흉");
    const firstRepair = machine.evaluate(transaction(74, 3, 3, "흉", "", cursor(3)));
    expect(firstRepair).toEqual({
      kind: "atomic-repair",
      insert: "ㅇ",
      replace: { from: 3, to: 3 },
      staleText: "휴",
      originalText: "더",
      source: "derived",
      nativeTailText: "흉",
    });
    if (firstRepair.kind !== "atomic-repair") throw new Error("expected repair");
    machine.commitAtomicRepair(firstRepair);
    expect(machine.getSourceGuard()).toEqual({ range: { from: 9, to: 10 }, text: "휴" });

    expect(staleDelete(machine, 80, 4, "ㅣ", "ㅇ")).toMatchObject({
      kind: "suppress-stale-delete",
      originalText: "ㅇ",
    });
    beforeInsert(machine, 83, "휴이");
    const secondRepair = machine.evaluate(transaction(84, 3, 3, "휴이", "", cursor(4)));
    expect(secondRepair).toEqual({
      kind: "atomic-repair",
      insert: "이",
      replace: { from: 3, to: 4 },
      staleText: "흉",
      originalText: "ㅇ",
      source: "derived",
      nativeTailText: "휴이",
    });
  });

  it("never treats a real Backspace as a pseudo rewrite", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine);
    key(machine, 70, "Backspace");
    beforeDelete(machine, 71);
    expect(machine.evaluate(transaction(72, 2, 3, "", "더", cursor(3), { userEvent: "delete.backward" }))).toEqual({ kind: "allow" });
  });

  it.each(["a", "7", "!"])("ends pseudo state for non-Korean input %s", (value) => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine);
    key(machine, 70, value);
    beforeInsert(machine, 71, value);
    expect(machine.getDebugSnapshot().selectionMovedOutsidePseudoRange).toBe(false);
    expect(machine.evaluate(transaction(72, 3, 3, value, "", cursor(3)))).toEqual({ kind: "allow" });
  });

  it.each(["HangulMode", "Lang1", "ModeChange", "CapsLock"])("ends pseudo state for language switch key %s", (value) => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine);
    key(machine, 70, value);
    expect(machine.getDebugSnapshot().pseudoComposition.active).toBe(false);
  });

  it.each([" ", "Enter"])("ends pseudo state for boundary key %s", (value) => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    key(machine, 70, value);
    expect(machine.getDebugSnapshot().pseudoComposition.active).toBe(false);
  });

  it("tracks the final destination through rapid arrow-key repeats", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine, 60, 6);
    expect(machine.onSelectionMove({ at: 62, before: cursor(6), after: cursor(5), origin: "select", textBeforeCursor: "1234567에휴" })).toBe(true);
    expect(machine.onSelectionMove({ at: 64, before: cursor(5), after: cursor(4), origin: "select", textBeforeCursor: "1234567에휴" })).toBe(true);
    expect(staleDelete(machine, 70, 4, "ㅇ").kind).toBe("suppress-stale-delete");
  });

  it("does not arm when a selection range is chosen", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    expect(machine.onSelectionMove({ at: 60, before: cursor(9), after: { from: 2, to: 5 }, origin: "select.pointer", textBeforeCursor: "1234567에휴" })).toBe(false);
    expect(machine.getDebugSnapshot().pseudoComposition.active).toBe(false);
  });

  it.each(["undo", "redo"])("clears candidates on %s", (userEvent) => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine);
    machine.onDocumentTransaction(userEvent, true);
    expect(staleDelete(machine, 70, 3, "ㅇ").kind).toBe("allow");
  });

  it("does not mistake an intentional same-syllable insertion for stale input", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine);
    key(machine, 70, "휴");
    beforeInsert(machine, 71, "휴");
    expect(machine.evaluate(transaction(72, 3, 3, "휴", "", cursor(3)))).toEqual({ kind: "allow" });
  });

  it("works with large document offsets without reading document context", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    const start = 100_000;
    initialInsert(machine, 10, start, "ㄱ");
    rewrite(machine, 20, { from: start, to: start + 1 }, "ㄱ", "가", "ㅏ");
    rewrite(machine, 30, { from: start, to: start + 1 }, "가", "각", "ㄱ");
    expect(machine.onSelectionMove({ at: 40, before: cursor(start + 1), after: cursor(20), origin: "select.pointer", textBeforeCursor: "embed]]각" })).toBe(true);
  });

  it("preserves a trusted pending Korean key when stale insertion cannot be derived", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine);
    expect(staleDelete(machine, 70, 3, "ㅇ").kind).toBe("suppress-stale-delete");
    beforeInsert(machine, 73, "가");
    const firstRepair = machine.evaluate(transaction(74, 3, 3, "가", "", cursor(3)));
    expect(firstRepair).toEqual({
      kind: "atomic-repair",
      insert: "ㅇ",
      replace: { from: 3, to: 3 },
      staleText: "휴",
      originalText: "더",
      source: "pending-intended-key",
      nativeTailText: "가",
    });
    if (firstRepair.kind !== "atomic-repair") throw new Error("expected repair");
    machine.commitAtomicRepair(firstRepair);

    expect(staleDelete(machine, 80, 4, "ㅣ", "ㅇ").kind).toBe("suppress-stale-delete");
    beforeInsert(machine, 83, "휴이");
    expect(machine.evaluate(transaction(84, 3, 3, "휴이", "", cursor(4)))).toMatchObject({
      kind: "atomic-repair",
      insert: "이",
      replace: { from: 3, to: 4 },
      source: "derived",
    });
  });

  it("appends an unprovable pending key instead of overwriting repaired intended text", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine);
    expect(staleDelete(machine, 70, 3, "ㅇ").kind).toBe("suppress-stale-delete");
    beforeInsert(machine, 73, "흉");
    const firstRepair = machine.evaluate(transaction(74, 3, 3, "흉", "", cursor(3)));
    if (firstRepair.kind !== "atomic-repair") throw new Error("expected repair");
    machine.commitAtomicRepair(firstRepair);

    expect(staleDelete(machine, 80, 4, "ㅣ", "ㅇ").kind).toBe("suppress-stale-delete");
    beforeInsert(machine, 83, "마");
    expect(machine.evaluate(transaction(84, 4, 4, "마", "", cursor(4)))).toEqual({
      kind: "atomic-repair",
      insert: "ㅣ",
      replace: { from: 4, to: 4 },
      staleText: "흉",
      originalText: "ㅇ",
      source: "pending-intended-key",
      nativeTailText: "마",
    });
  });

  it("keeps a confirmed moved guard beyond 1.5 seconds until an explicit boundary", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    expect(move(machine, 11_060)).toBe(true);
    expect(staleDelete(machine, 11_070, 3, "ㅇ").kind).toBe("suppress-stale-delete");
  });

  it("discards the old intended range when selection moves again after a repair", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine);
    expect(staleDelete(machine, 70, 3, "ㅇ").kind).toBe("suppress-stale-delete");
    beforeInsert(machine, 73, "흉");
    const repair = machine.evaluate(transaction(74, 3, 3, "흉", "", cursor(3)));
    if (repair.kind !== "atomic-repair") throw new Error("expected repair");
    machine.commitAtomicRepair(repair);

    expect(machine.onSelectionMove({
      at: 2_500,
      before: cursor(4),
      after: cursor(2),
      origin: "select",
      textBeforeCursor: "1234567에휴",
    })).toBe(true);
    expect(staleDelete(machine, 12_000, 2, "ㅁ", "나")).toMatchObject({
      kind: "suppress-stale-delete",
      originalText: "나",
    });
  });

  it("ends the session on an external focus boundary", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    trainEhyu(machine);
    move(machine);
    machine.onExternalFocusBoundary();

    expect(machine.getDebugSnapshot().pseudoComposition.active).toBe(false);
    expect(machine.getDebugSnapshot().selectionMovedOutsidePseudoRange).toBe(false);
    expect(staleDelete(machine, 5_000, 3, "ㅇ").kind).toBe("allow");
  });

  it("rejects slow pairs, adjacent ranges, non-input transactions, and missing source text", () => {
    const variants: Partial<PseudoTransactionSignal>[] = [
      { at: 300 },
      { from: 1, to: 2 },
      { userEvent: "delete.backward" },
      { sourceStillPresent: false },
      { changeCount: 2 },
    ];
    for (const variant of variants) {
      const machine = new KoreanPseudoCompositionStateMachine();
      trainEhyu(machine);
      move(machine);
      key(machine, 70, "ㅇ");
      beforeDelete(machine, 71);
      const signal = transaction(72, 2, 3, "", "더", cursor(3), variant);
      expect(machine.evaluate(signal).kind).toBe("allow");
    }
  });

  it("requires two completed rewrites before selection movement is risky", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    initialInsert(machine, 10, 7, "ㅇ");
    rewrite(machine, 20, { from: 7, to: 8 }, "ㅇ", "에", "ㅔ");
    expect(machine.onSelectionMove({ at: 30, before: cursor(8), after: cursor(3), origin: "select", textBeforeCursor: "1234567에" })).toBe(false);
  });

  it("recognizes only related Hangul rewrites", () => {
    expect(isConnectedHangulRewrite("가", "각")).toBe(true);
    expect(isConnectedHangulRewrite("엫", "에휴")).toBe(true);
    expect(isConnectedHangulRewrite("ㅇ", "에")).toBe(true);
    expect(isConnectedHangulRewrite("가", "나")).toBe(false);
    expect(isConnectedHangulRewrite("a", "가")).toBe(false);
  });
});
