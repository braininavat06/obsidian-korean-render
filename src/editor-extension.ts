import { Annotation, Prec, Transaction, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { snippet, type DebugEntry, type DebugRingBuffer } from "./debug-log";
import {
  KoreanImeStateMachine,
  type SelectionOrigin,
  type SelectionSnapshot,
} from "./ime-state-machine";

export interface ExtensionController {
  isFixEnabled(): boolean;
  isDebugEnabled(): boolean;
  readonly debugLog: DebugRingBuffer;
}

export const imeSuppression = Annotation.define<string>();

function selectionSnapshot(view: EditorView): SelectionSnapshot {
  const main = view.state.selection.main;
  return { from: main.from, to: main.to };
}

function userEventOf(update: ViewUpdate): string | undefined {
  for (let index = update.transactions.length - 1; index >= 0; index--) {
    const userEvent = update.transactions[index]?.annotation(Transaction.userEvent);
    if (userEvent) return userEvent;
  }
  return undefined;
}

function selectionOrigin(userEvent: string | undefined): SelectionOrigin {
  if (userEvent?.startsWith("select.pointer")) return "select.pointer";
  if (userEvent?.startsWith("select")) return "select";
  return "other";
}

class KoreanImeViewTracker {
  readonly machine = new KoreanImeStateMachine();
  private readonly listeners: Array<[string, EventListener]> = [];

  constructor(
    readonly view: EditorView,
    private readonly controller: ExtensionController,
  ) {
    for (const type of [
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "beforeinput",
      "input",
      "keydown",
    ]) {
      const listener: EventListener = (event) => this.onDomEvent(event);
      view.contentDOM.addEventListener(type, listener, { capture: true });
      this.listeners.push([type, listener]);
    }
  }

  update(update: ViewUpdate): void {
    const userEvent = userEventOf(update);

    if (this.controller.isFixEnabled() && update.selectionSet && !update.docChanged) {
      const before = update.startState.selection.main;
      const after = update.state.selection.main;
      this.machine.onSelectionMove({
        at: Date.now(),
        before: { from: before.from, to: before.to },
        after: { from: after.from, to: after.to },
        origin: selectionOrigin(userEvent),
        textBeforeCursor: update.state.sliceDoc(Math.max(0, before.to - 8), before.to),
      });
    }

    if (this.controller.isFixEnabled()) {
      for (const transaction of update.transactions) {
        this.machine.onTransaction(
          transaction.annotation(Transaction.userEvent),
          transaction.docChanged,
        );
      }
    }

    if (!this.controller.isDebugEnabled()) return;

    if (update.selectionSet) {
      const beforeSelection = update.startState.selection.main;
      const afterSelection = update.state.selection.main;
      this.controller.debugLog.create({
        eventType: "selection-change",
        selectionFrom: afterSelection.from,
        selectionTo: afterSelection.to,
        before: snippet(update.startState.doc, update.startState.selection),
        after: snippet(update.state.doc, update.state.selection),
        userEvent,
        details: {
          previousSelectionFrom: beforeSelection.from,
          previousSelectionTo: beforeSelection.to,
          docChanged: update.docChanged,
          cmComposing: update.view.composing,
          cmCompositionStarted: update.view.compositionStarted,
        },
      });
    }

    for (const transaction of update.transactions) {
      if (!transaction.docChanged) continue;
      const changes: Array<{ from: number; to: number; insert: string }> = [];
      transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({ from: fromA, to: toA, insert: inserted.toString() });
      });
      const main = transaction.newSelection.main;
      this.controller.debugLog.create({
        eventType: "cm-document-transaction",
        selectionFrom: main.from,
        selectionTo: main.to,
        before: snippet(transaction.startState.doc, transaction.startState.selection),
        after: snippet(transaction.newDoc, transaction.newSelection),
        userEvent: transaction.annotation(Transaction.userEvent),
        changes,
        details: {
          cmComposing: update.view.composing,
          cmCompositionStarted: update.view.compositionStarted,
        },
      });
    }
  }

  logSuppression(reason: string, inserted: string, from: number): void {
    if (!this.controller.isDebugEnabled()) return;
    const current = snippet(this.view.state.doc, this.view.state.selection);
    this.controller.debugLog.create({
      eventType: "workaround-suppressed-input",
      data: inserted,
      selectionFrom: this.view.state.selection.main.from,
      selectionTo: this.view.state.selection.main.to,
      before: current,
      after: current,
      details: { reason, insertionFrom: from },
    });
  }

  destroy(): void {
    for (const [type, listener] of this.listeners) {
      this.view.contentDOM.removeEventListener(type, listener, { capture: true });
    }
  }

  private onDomEvent(event: Event): void {
    if (!this.controller.isFixEnabled() && !this.controller.isDebugEnabled()) return;

    const now = Date.now();
    const compositionEvent = event as CompositionEvent;
    const inputEvent = event as InputEvent;
    const keyboardEvent = event as KeyboardEvent;

    if (this.controller.isFixEnabled()) {
      switch (event.type) {
        case "compositionstart":
          this.machine.onCompositionStart();
          break;
        case "compositionupdate":
          this.machine.onCompositionUpdate(compositionEvent.data ?? "");
          break;
        case "compositionend":
          this.machine.onCompositionEnd(compositionEvent.data ?? "");
          break;
        case "beforeinput":
          this.machine.onBeforeInput({
            at: now,
            data: inputEvent.data,
            inputType: inputEvent.inputType,
            isComposing: inputEvent.isComposing,
          });
          break;
        case "keydown":
          this.machine.onKeyDown({
            at: now,
            key: keyboardEvent.key,
            isComposing: keyboardEvent.isComposing,
          });
          break;
      }
    }

    if (!this.controller.isDebugEnabled()) return;

    const before = snippet(this.view.state.doc, this.view.state.selection);
    const selection = selectionSnapshot(this.view);
    const entry = this.controller.debugLog.create({
      eventType: event.type,
      data:
        event.type.startsWith("composition") || event.type === "beforeinput" || event.type === "input"
          ? (compositionEvent.data ?? null)
          : undefined,
      inputType:
        event.type === "beforeinput" || event.type === "input" ? inputEvent.inputType : undefined,
      isComposing:
        event.type === "beforeinput" || event.type === "input" || event.type === "keydown"
          ? (event as InputEvent | KeyboardEvent).isComposing
          : undefined,
      key: event.type === "keydown" ? keyboardEvent.key : undefined,
      keyCode: event.type === "keydown" ? keyboardEvent.keyCode : undefined,
      selectionFrom: selection.from,
      selectionTo: selection.to,
      before,
      after: before,
      details: {
        cmComposing: this.view.composing,
        cmCompositionStarted: this.view.compositionStarted,
      },
    });

    queueMicrotask(() => this.captureAfter(entry));
  }

  private captureAfter(entry: DebugEntry): void {
    if (!this.controller.isDebugEnabled()) return;
    entry.after = snippet(this.view.state.doc, this.view.state.selection);
  }
}

export function createKoreanImeEditorExtension(controller: ExtensionController): Extension {
  const trackerPlugin: ViewPlugin<KoreanImeViewTracker> = ViewPlugin.define(
    (view) => new KoreanImeViewTracker(view, controller),
  );

  const inputHandler = EditorView.inputHandler.of((view, from, _to, text, defaultInsert) => {
    if (!controller.isFixEnabled()) return false;

    const tracker = view.plugin(trackerPlugin);
    const moved = tracker?.machine.getMovedComposition();
    if (!tracker || !moved) return false;

    const transaction = defaultInsert();
    let changeCount = 0;
    let transactionFrom = -1;
    let transactionTo = -1;
    let transactionInsert = "";
    transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changeCount++;
      transactionFrom = fromA;
      transactionTo = toA;
      transactionInsert = inserted.toString();
    });

    const sourceStillPresent =
      moved.sourceFrom >= 0 &&
      moved.sourceTo <= view.state.doc.length &&
      view.state.sliceDoc(moved.sourceFrom, moved.sourceTo) === moved.text;
    const main = view.state.selection.main;
    const decision = tracker.machine.evaluate({
      at: Date.now(),
      from: transactionFrom,
      to: transactionTo,
      insert: transactionInsert,
      changeCount,
      userEvent: transaction.annotation(Transaction.userEvent),
      selectionBefore: { from: main.from, to: main.to },
      sourceStillPresent,
    });

    if (!decision.suppress) return false;

    tracker.logSuppression(decision.reason ?? "unknown", text, from);
    view.dispatch({
      selection: view.state.selection,
      annotations: [
        Transaction.addToHistory.of(false),
        imeSuppression.of(decision.reason ?? "unknown"),
      ],
    });
    return true;
  });

  return [Prec.highest(inputHandler), trackerPlugin];
}
