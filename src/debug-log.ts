import type { EditorSelection, Text } from "@codemirror/state";

export interface DocumentSnippet {
  from: number;
  to: number;
  text: string;
}

export interface DebugEntry {
  seq: number;
  timestamp: string;
  elapsedMs: number;
  eventType: string;
  data?: string | null;
  inputType?: string;
  isComposing?: boolean;
  key?: string;
  keyCode?: number;
  selectionFrom: number;
  selectionTo: number;
  before: DocumentSnippet;
  after: DocumentSnippet;
  userEvent?: string;
  changes?: Array<{ from: number; to: number; insert: string }>;
  details?: Record<string, unknown>;
}

const SNIPPET_RADIUS = 24;

export function snippet(doc: Text, selection: EditorSelection): DocumentSnippet {
  const main = selection.main;
  const from = Math.max(0, main.from - SNIPPET_RADIUS);
  const to = Math.min(doc.length, main.to + SNIPPET_RADIUS);
  return { from, to, text: doc.sliceString(from, to) };
}

export class DebugRingBuffer {
  private readonly entries: DebugEntry[] = [];
  private nextSeq = 1;
  private readonly startedAt = performance.now();

  constructor(private readonly capacity = 500) {}

  create(entry: Omit<DebugEntry, "seq" | "timestamp" | "elapsedMs">): DebugEntry {
    const item: DebugEntry = {
      ...entry,
      seq: this.nextSeq++,
      timestamp: new Date().toISOString(),
      elapsedMs: Math.round((performance.now() - this.startedAt) * 10) / 10,
    };
    this.entries.push(item);
    if (this.entries.length > this.capacity) this.entries.shift();
    return item;
  }

  clear(): void {
    this.entries.length = 0;
  }

  export(header: Record<string, unknown>): string {
    return [JSON.stringify({ type: "header", ...header }), ...this.entries.map((entry) => JSON.stringify(entry))].join("\n");
  }

  get size(): number {
    return this.entries.length;
  }
}
