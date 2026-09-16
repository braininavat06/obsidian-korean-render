import { describe, expect, it } from "vitest";

import type { SelectionSnapshot } from "../src/ime-state-machine";
import {
  KoreanPseudoCompositionStateMachine,
  PSEUDO_MIN_REWRITES,
  type PseudoTransactionSignal,
} from "../src/pseudo-composition-state-machine";
import { IPADOS_V016_SINGLE_REWRITE } from "./fixtures/ipados-v016-single-rewrite";

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

function beforeInsert(machine: KoreanPseudoCompositionStateMachine, at: number, data: string): void {
  machine.onBeforeInput({ at, data, inputType: "insertText", isComposing: false });
}

function initial(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  position: number,
  keyText: string,
  inserted = keyText,
  selection: SelectionSnapshot = cursor(position),
): void {
  key(machine, at, keyText, selection);
  beforeInsert(machine, at + 1, inserted);
  expect(
    machine.evaluate(transaction(at + 2, position, position, inserted, "", selection)),
  ).toEqual({ kind: "allow" });
}

function rewrite(
  machine: KoreanPseudoCompositionStateMachine,
  at: number,
  range: { from: number; to: number },
  previous: string,
  replacement: string,
  inputKey: string,
  deleteRange = range,
): void {
  key(machine, at, inputKey, cursor(range.to));
  beforeDelete(machine, at + 1);
  expect(machine.evaluate(transaction(
    at + 2,
    deleteRange.from,
    deleteRange.to,
    "",
    previous,
    cursor(range.to),
  ))).toEqual({ kind: "allow" });
  beforeInsert(machine, at + 3, replacement);
  expect(machine.evaluate(transaction(
    at + 4,
    range.from,
    range.from,
    replacement,
    "",
    cursor(range.from),
  ))).toEqual({ kind: "allow" });
}

function confirmedSingle(
  initialText = "ㄲ",
  replacement = "까",
  inputKey = "ㅏ",
): KoreanPseudoCompositionStateMachine {
  const machine = new KoreanPseudoCompositionStateMachine();
  initial(machine, 0, 71, initialText);
  rewrite(machine, 40, { from: 71, to: 72 }, initialText, replacement, inputKey);
  return machine;
}

function moveFromSource(
  machine: KoreanPseudoCompositionStateMachine,
  destination = 68,
  sourceText = "까",
): boolean {
  return machine.onSelectionMove({
    at: 60,
    before: cursor(72),
    after: cursor(destination),
    origin: "select",
    textBeforeCursor: `${"x".repeat(71)}${sourceText}`,
  });
}

describe("anonymized iPadOS v0.1.6 single-rewrite lineage", () => {
  it("A: confirms ㄲ → exact delete ㄲ → 까 and arms a moved guard", () => {
    const machine = confirmedSingle();
    expect(PSEUDO_MIN_REWRITES).toBe(2);
    expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
      rewriteCount: 1,
      guardConfidence: "single-confirmed-lineage",
      singleRewriteLineage: {
        initialText: "ㄲ",
        initialRange: { from: 71, to: 72 },
        deletedText: "ㄲ",
        deletedRange: { from: 71, to: 72 },
        replacementText: "까",
        replacementRange: { from: 71, to: 72 },
        rewriteIntervalMs: 42,
        deleteInsertIntervalMs: 2,
      },
    });
    expect(machine.drainDiagnostics()).toContainEqual(expect.objectContaining({
      eventType: "single-rewrite-lineage-confirmed",
    }));
    expect(moveFromSource(machine)).toBe(true);
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      guardConfidence: "single-confirmed-lineage",
      protectedSourceText: "까",
      destination: cursor(68),
    });
  });

  it("B: confirms the equivalent ㄱ → exact delete ㄱ → 가 lineage", () => {
    const machine = confirmedSingle("ㄱ", "가", "ㅏ");
    expect(moveFromSource(machine, 68, "가")).toBe(true);
    expect(machine.getDebugSnapshot().movedGuard?.guardConfidence).toBe(
      "single-confirmed-lineage",
    );
  });

  it("C/D: does not arm for a lone Jamo or a simple completed-syllable insertion", () => {
    const loneJamo = new KoreanPseudoCompositionStateMachine();
    initial(loneJamo, 0, 71, "ㄱ");
    expect(moveFromSource(loneJamo, 68, "ㄱ")).toBe(false);

    const syllable = new KoreanPseudoCompositionStateMachine();
    initial(syllable, 0, 71, "가");
    expect(moveFromSource(syllable, 68, "가")).toBe(false);
  });

  it("E: rejects a deletion that is not the initial fragment's exact range", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    initial(machine, 0, 71, "ㄱ");
    rewrite(machine, 40, { from: 71, to: 72 }, "ㄱ", "가", "ㅏ", { from: 70, to: 71 });
    expect(moveFromSource(machine, 68, "가")).toBe(false);
  });

  it("F: rejects an unrelated Hangul replacement after the exact delete", () => {
    const machine = new KoreanPseudoCompositionStateMachine();
    initial(machine, 0, 71, "ㄱ");
    rewrite(machine, 40, { from: 71, to: 72 }, "ㄱ", "나", "ㅏ");
    expect(moveFromSource(machine, 68, "나")).toBe(false);
  });

  it("rejects range input, an interrupted lineage, and a replacement outside the burst", () => {
    const rangeInput = new KoreanPseudoCompositionStateMachine();
    initial(rangeInput, 0, 71, "ㄱ", "ㄱ", { from: 70, to: 71 });
    expect(moveFromSource(rangeInput, 68, "ㄱ")).toBe(false);

    const interrupted = new KoreanPseudoCompositionStateMachine();
    initial(interrupted, 0, 71, "ㄱ");
    expect(interrupted.onSelectionMove({
      at: 10,
      before: cursor(72),
      after: cursor(70),
      origin: "select",
      textBeforeCursor: `${"x".repeat(71)}ㄱ`,
    })).toBe(false);
    rewrite(interrupted, 40, { from: 71, to: 72 }, "ㄱ", "가", "ㅏ");
    expect(moveFromSource(interrupted, 68, "가")).toBe(false);

    const expired = new KoreanPseudoCompositionStateMachine();
    initial(expired, 0, 71, "ㄱ");
    rewrite(expired, 200, { from: 71, to: 72 }, "ㄱ", "가", "ㅏ");
    expect(moveFromSource(expired, 68, "가")).toBe(false);
  });

  it("rejects a replacement at another range and clears evidence at native boundaries", () => {
    const shiftedReplacement = new KoreanPseudoCompositionStateMachine();
    initial(shiftedReplacement, 0, 71, "ㄱ");
    key(shiftedReplacement, 40, "ㅏ", cursor(72));
    beforeDelete(shiftedReplacement, 41);
    expect(shiftedReplacement.evaluate(
      transaction(42, 71, 72, "", "ㄱ", cursor(72)),
    )).toEqual({ kind: "allow" });
    beforeInsert(shiftedReplacement, 43, "가");
    expect(shiftedReplacement.evaluate(
      transaction(44, 72, 72, "가", "", cursor(72)),
    )).toEqual({ kind: "allow" });
    expect(shiftedReplacement.getDebugSnapshot().pseudoComposition.guardConfidence).toBeNull();

    for (const boundary of ["paste", "composition", "undo"] as const) {
      const machine = new KoreanPseudoCompositionStateMachine();
      initial(machine, 0, 71, "ㄱ");
      if (boundary === "paste") {
        machine.onBeforeInput({
          at: 10,
          data: "가",
          inputType: "insertFromPaste",
          isComposing: false,
        });
      } else if (boundary === "composition") {
        machine.onRealCompositionEvent();
      } else {
        machine.onDocumentTransaction("undo", true);
      }
      expect(machine.getDebugSnapshot().pseudoComposition.guardConfidence).toBeNull();
    }
  });

  it("G: leaves normal same-position Korean continuation untouched", () => {
    const machine = confirmedSingle("ㄱ", "가", "ㅏ");
    rewrite(machine, 50, { from: 71, to: 72 }, "가", "각", "ㄱ");
    expect(machine.getDebugSnapshot().selectionMovedOutsidePseudoRange).toBe(false);
    expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
      lastText: "각",
      rewriteCount: 2,
      guardConfidence: "multi-rewrite",
    });
  });

  it("H: blocks the traced destination delete and starts repair from the actual ㅇ key", () => {
    const fixture = IPADOS_V016_SINGLE_REWRITE;
    const machine = confirmedSingle();
    expect(moveFromSource(machine, fixture.staleAttempt.destination)).toBe(true);
    const beforeDocument = `${"x".repeat(67)}이${"x".repeat(3)}까`;

    key(machine, 70, fixture.staleAttempt.key, cursor(fixture.staleAttempt.destination));
    beforeDelete(machine, 71);
    const deletion = machine.evaluate(transaction(
      72,
      fixture.staleAttempt.deletedRange.from,
      fixture.staleAttempt.deletedRange.to,
      "",
      fixture.staleAttempt.deletedText,
      cursor(fixture.staleAttempt.destination),
    ));
    expect(deletion).toMatchObject({ kind: "suppress-stale-delete" });
    expect(beforeDocument.slice(67, 68)).toBe("이");

    beforeInsert(machine, 73, fixture.staleAttempt.nativeData);
    const repair = machine.evaluate(transaction(
      74,
      fixture.staleAttempt.destination,
      fixture.staleAttempt.destination,
      fixture.staleAttempt.nativeData,
      "",
      cursor(fixture.staleAttempt.destination),
    ));
    expect(repair).toMatchObject({
      kind: "atomic-repair",
      insert: "ㅇ",
      source: "derived",
    });
    expect(JSON.stringify(repair)).not.toContain("까오");
    expect(JSON.stringify(repair)).not.toContain("왜");
  });

  it("I: preserves the existing two-rewrite confidence path", () => {
    const machine = confirmedSingle("ㄱ", "가", "ㅏ");
    rewrite(machine, 50, { from: 71, to: 72 }, "가", "각", "ㄱ");
    expect(moveFromSource(machine, 68, "각")).toBe(true);
    expect(machine.getDebugSnapshot().movedGuard?.guardConfidence).toBe("multi-rewrite");
  });

  it("uses the measured v0.1.6 trace coordinates without broadening the rule", () => {
    expect(IPADOS_V016_SINGLE_REWRITE).toMatchObject({
      initial: { text: "ㄲ", range: { from: 71, to: 72 } },
      rewrite: {
        deletedText: "ㄲ",
        replacementText: "까",
        replacementRange: { from: 71, to: 72 },
      },
      cursorPath: [71, 70, 69, 68],
      staleAttempt: { deletedText: "이", nativeData: "깡" },
    });
  });
});
