import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { DebugRingBuffer, snippet } from "../src/debug-log";

describe("debug log privacy bounds", () => {
  it("keeps only the cursor-adjacent context", () => {
    const document = `${"A".repeat(100)}커서${"B".repeat(100)}`;
    const state = EditorState.create({
      doc: document,
      selection: EditorSelection.cursor(102),
    });
    const context = snippet(state.doc, state.selection);
    expect(context.text.length).toBeLessThanOrEqual(48);
    expect(context.text).not.toBe(document);
    expect(context.from).toBe(78);
    expect(context.to).toBe(126);
  });

  it("does not add document content beyond the supplied snippets", () => {
    const log = new DebugRingBuffer(2);
    log.create({
      eventType: "test",
      selectionFrom: 0,
      selectionTo: 0,
      before: { from: 0, to: 1, text: "가" },
      after: { from: 0, to: 1, text: "가" },
    });
    const output = log.export({ pluginVersion: "0.1.1" });
    expect(output).toContain('"text":"가"');
    expect(output).not.toContain("vaultPath");
    expect(output).not.toContain("noteTitle");
  });
});
