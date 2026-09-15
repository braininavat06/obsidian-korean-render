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

  it("clears only the in-memory entries immediately", () => {
    const log = new DebugRingBuffer(2);
    log.create({
      eventType: "beforeinput",
      selectionFrom: 1,
      selectionTo: 1,
      before: { from: 0, to: 1, text: "가" },
      after: { from: 0, to: 1, text: "가" },
    });
    expect(log.size).toBe(1);

    log.clear();

    expect(log.size).toBe(0);
    expect(log.export({ pluginVersion: "0.1.1" }).split("\n")).toHaveLength(1);
  });

  it("does not clear entries when the same log is exported repeatedly", () => {
    const log = new DebugRingBuffer(2);
    log.create({
      eventType: "input",
      selectionFrom: 1,
      selectionTo: 1,
      before: { from: 0, to: 1, text: "한" },
      after: { from: 0, to: 1, text: "한" },
    });

    const first = log.export({ pluginVersion: "0.1.1" });
    const second = log.export({ pluginVersion: "0.1.1" });

    expect(second).toBe(first);
    expect(log.size).toBe(1);
  });
});
