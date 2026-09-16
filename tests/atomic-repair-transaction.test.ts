import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  createAtomicRepairTransaction,
  imeSuppression,
} from "../src/editor-extension";
import type { AtomicRepairDecision } from "../src/pseudo-composition-state-machine";

function repair(insert: string, from: number, to: number, originalText: string): AtomicRepairDecision {
  return {
    kind: "atomic-repair",
    insert,
    replace: { from, to },
    staleText: "휴",
    originalText,
    source: "derived",
    nativeTailText: insert,
  };
}

describe("atomic repair transaction", () => {
  it("preserves the destination character and creates one normal input transaction", () => {
    const state = EditorState.create({
      doc: "랜더링",
      selection: EditorSelection.cursor(3),
    });
    const transaction = createAtomicRepairTransaction(state, repair("ㅇ", 3, 3, "링"));

    expect(transaction.newDoc.toString()).toBe("랜더링ㅇ");
    expect(transaction.newSelection.main.from).toBe(4);
    expect(transaction.annotation(Transaction.userEvent)).toBe("input.type");
    expect(transaction.annotation(Transaction.addToHistory)).not.toBe(false);
    expect(transaction.annotation(imeSuppression)).toBe("pseudo-atomic-repair");
  });

  it("replaces only the intended temporary range on the 휴이 continuation", () => {
    const state = EditorState.create({
      doc: "랜더링ㅇ",
      selection: EditorSelection.cursor(4),
    });
    const transaction = createAtomicRepairTransaction(state, repair("이", 3, 4, "ㅇ"));
    expect(transaction.newDoc.toString()).toBe("랜더링이");
    expect(transaction.newDoc.toString()).not.toContain("흉");
    expect(transaction.newDoc.toString()).not.toContain("휴이");
  });

  it("has an exact inverse without exposing a deleted destination character", () => {
    const state = EditorState.create({ doc: "랜더링", selection: EditorSelection.cursor(3) });
    const transaction = createAtomicRepairTransaction(state, repair("ㅇ", 3, 3, "링"));
    const inverse = transaction.changes.invert(transaction.startState.doc);
    const undone = transaction.state.update({ changes: inverse });
    expect(undone.newDoc.toString()).toBe("랜더링");
  });

  it("preserves every existing character when falling back to a pending intended key", () => {
    const state = EditorState.create({ doc: "이놈", selection: EditorSelection.cursor(1) });
    const decision: AtomicRepairDecision = {
      ...repair("ㅁ", 1, 1, "이"),
      source: "pending-intended-key",
    };
    const transaction = createAtomicRepairTransaction(state, decision);

    expect(transaction.newDoc.toString()).toBe("이ㅁ놈");
    expect(transaction.annotation(Transaction.userEvent)).toBe("input.type");
    expect(transaction.annotation(Transaction.addToHistory)).not.toBe(false);
  });

  it("round-trips a multi-syllable native rewrite through undo and redo changes", () => {
    const state = EditorState.create({
      doc: "가나가다라",
      selection: EditorSelection.cursor(3),
    });
    const decision: AtomicRepairDecision = {
      kind: "atomic-repair",
      insert: "가나",
      replace: { from: 2, to: 3 },
      staleText: "라",
      originalText: "가",
      source: "native-rewrite",
      nativeTailText: "가나",
    };
    const transaction = createAtomicRepairTransaction(state, decision);
    expect(transaction.newDoc.toString()).toBe("가나가나다라");
    expect(transaction.newSelection.main.from).toBe(4);

    const inverse = transaction.changes.invert(transaction.startState.doc);
    const undone = transaction.state.update({ changes: inverse });
    expect(undone.newDoc.toString()).toBe("가나가다라");

    const redone = undone.state.update({ changes: transaction.changes });
    expect(redone.newDoc.toString()).toBe("가나가나다라");
  });
});
