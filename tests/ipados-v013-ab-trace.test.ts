import { describe, expect, it } from "vitest";

import type { SelectionSnapshot } from "../src/ime-state-machine";
import {
  KoreanPseudoCompositionStateMachine,
  type AtomicRepairDecision,
  type PseudoTransactionSignal,
} from "../src/pseudo-composition-state-machine";
import {
  IPADOS_V013_A_OFF,
  IPADOS_V013_B_ON,
  type IpadTraceFixture,
} from "./fixtures/ipados-v013-ab-traces";

const cursor = (position: number): SelectionSnapshot => ({ from: position, to: position });

function signal(
  at: number,
  from: number,
  to: number,
  insert: string,
  deletedText: string,
  position: number,
  sourceStillPresent = true,
): PseudoTransactionSignal {
  return {
    at,
    from,
    to,
    insert,
    deletedText,
    changeCount: 1,
    userEvent: "input.type",
    selectionBefore: cursor(position),
    sourceStillPresent,
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

function applyRepair(document: string, decision: AtomicRepairDecision): string {
  return (
    document.slice(0, decision.replace.from) +
    decision.insert +
    document.slice(decision.replace.to)
  );
}

function replay(fixture: IpadTraceFixture): {
  document: string;
  sources: AtomicRepairDecision["source"][];
} {
  const machine = new KoreanPseudoCompositionStateMachine();
  let now = 10;
  let document = "";

  key(machine, now, "ㄱ");
  beforeInsert(machine, now + 1, "ㄱ");
  expect(machine.evaluate(signal(now + 2, 0, 0, "ㄱ", "", 0))).toEqual({ kind: "allow" });
  document = "ㄱ";

  for (const rewrite of fixture.training) {
    now += 10;
    key(machine, now, rewrite.key);
    beforeDelete(machine, now + 1);
    expect(
      machine.evaluate(
        signal(
          now + 2,
          rewrite.from,
          rewrite.to,
          "",
          rewrite.previous,
          rewrite.to,
        ),
      ),
    ).toEqual({ kind: "allow" });
    document = document.slice(0, rewrite.from) + document.slice(rewrite.to);

    beforeInsert(machine, now + 3, rewrite.inserted);
    expect(
      machine.evaluate(
        signal(now + 4, rewrite.from, rewrite.from, rewrite.inserted, "", rewrite.from),
      ),
    ).toEqual({ kind: "allow" });
    document = document.slice(0, rewrite.from) + rewrite.inserted + document.slice(rewrite.from);
  }

  expect(document).toBe(fixture.initialDocument);
  expect(machine.getDebugSnapshot().pseudoComposition).toMatchObject({
    active: true,
    lastText: fixture.sourceText,
    rewriteCount: fixture.training.length,
  });

  let position = document.length;
  for (const destination of fixture.movePath) {
    now += 10;
    expect(
      machine.onSelectionMove({
        at: now,
        before: cursor(position),
        after: cursor(destination),
        origin: "select",
        textBeforeCursor: document.slice(0, position),
      }),
    ).toBe(true);
    position = destination;
  }

  const sources: AtomicRepairDecision["source"][] = [];
  for (const rewrite of fixture.postMove) {
    now += 10;
    key(machine, now, rewrite.key);
    beforeDelete(machine, now + 1);
    const deletedFrom = position - 1;
    const deletedText = document.slice(deletedFrom, position);
    expect(
      machine.evaluate(
        signal(now + 2, deletedFrom, position, "", deletedText, position),
      ),
    ).toMatchObject({ kind: "suppress-stale-delete", originalText: deletedText });

    beforeInsert(machine, now + 3, rewrite.inputData);
    const decision = machine.evaluate(
      signal(now + 4, position, position, rewrite.inputData, "", position),
    );
    expect(decision).toMatchObject({
      kind: "atomic-repair",
      insert: rewrite.expectedInsert,
      source: rewrite.expectedSource,
    });
    if (decision.kind !== "atomic-repair") throw new Error("expected atomic repair");

    document = applyRepair(document, decision);
    position = decision.replace.from + decision.insert.length;
    machine.commitAtomicRepair(decision);
    sources.push(decision.source);
    expect(document).toBe(rewrite.expectedDocument);

    const source = machine.getSourceGuard();
    expect(source).toBeDefined();
    if (source) expect(document.slice(source.range.from, source.range.to)).toBe(source.text);
    expect(machine.getDebugSnapshot().movedGuard).toMatchObject({
      destination: cursor(position),
    });
  }

  return { document, sources };
}

describe("anonymized iPadOS v0.1.3 A/B traces", () => {
  it("replays A/OFF without losing destination text or degrading composed input to raw Jamo", () => {
    const result = replay(IPADOS_V013_A_OFF);
    expect(result.document).toBe("가가나다라나다");
    expect(result.sources).toEqual([
      "derived",
      "derived",
      "native-rewrite",
      "native-rewrite",
      "native-rewrite",
      "native-rewrite",
      "native-rewrite",
      "native-rewrite",
    ]);
  });

  it("replays B/ON as stale because the measured reset did not end native state", () => {
    expect(IPADOS_V013_B_ON.reset).toMatchObject({
      selectionsPreserved: true,
      scrollPreserved: true,
      firstInputDeleteObserved: true,
      firstInputData: ["락", "락"],
      resetToFirstInputMs: [249, 410],
    });
    const result = replay(IPADOS_V013_B_ON);
    expect(result.document).toBe("가나가나다라다라");
  });
});
