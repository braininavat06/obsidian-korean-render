import {
  Annotation,
  EditorSelection,
  Prec,
  Transaction,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { snippet, type DebugEntry, type DebugRingBuffer } from "./debug-log";
import {
  KoreanImeStateMachine,
  type SelectionOrigin,
  type SelectionSnapshot,
} from "./ime-state-machine";
import {
  KoreanPseudoCompositionStateMachine,
  type AtomicRepairDecision,
  type PseudoDecision,
  type PseudoTransactionSignal,
} from "./pseudo-composition-state-machine";

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
  readonly pseudo = new KoreanPseudoCompositionStateMachine();
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
      "touchstart",
      "blur",
      "focus",
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
      const move = {
        at: Date.now(),
        before: { from: before.from, to: before.to },
        after: { from: after.from, to: after.to },
        origin: selectionOrigin(userEvent),
        textBeforeCursor: update.startState.sliceDoc(Math.max(0, before.to - 8), before.to),
      } as const;
      this.machine.onSelectionMove(move);
      if (this.pseudo.onSelectionMove(move)) {
        const snapshot = this.pseudo.getDebugSnapshot();
        this.logDiagnostic("pseudo-moved-guard-armed", {
          origin: move.origin,
          "selection-before": move.before,
          "selection-after": move.after,
          guardConfidence: snapshot.movedGuard?.guardConfidence ?? null,
        });
      }
    }

    if (this.controller.isFixEnabled()) {
      for (const transaction of update.transactions) {
        const transactionUserEvent = transaction.annotation(Transaction.userEvent);
        this.machine.onTransaction(transactionUserEvent, transaction.docChanged);
        this.pseudo.onDocumentTransaction(
          transactionUserEvent,
          transaction.docChanged,
          transaction.annotation(imeSuppression) === "pseudo-atomic-repair",
        );
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
        this.pseudo.onAppliedTransaction({
          at: Date.now(),
          userEvent: transactionUserEvent,
          docChanged: transaction.docChanged,
          changeCount,
          from: transactionFrom,
          to: transactionTo,
          insert: transactionInsert,
          selectionBefore: {
            from: transaction.startState.selection.main.from,
            to: transaction.startState.selection.main.to,
          },
          selectionAfter: {
            from: transaction.newSelection.main.from,
            to: transaction.newSelection.main.to,
          },
        });
      }
      this.flushPseudoDiagnostics();
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
          ...this.pseudo.getDebugSnapshot(),
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
          ...this.pseudo.getDebugSnapshot(),
        },
      });
    }
  }

  logSuppression(reason: string, inserted: string, from: number): void {
    this.logDiagnostic("workaround-suppressed-input", {
      reason,
      insertionFrom: from,
      data: inserted,
    });
  }

  logDiagnostic(eventType: string, details: Record<string, unknown>): void {
    if (!this.controller.isDebugEnabled()) return;
    const current = snippet(this.view.state.doc, this.view.state.selection);
    const selection = selectionSnapshot(this.view);
    this.controller.debugLog.create({
      eventType,
      selectionFrom: selection.from,
      selectionTo: selection.to,
      before: current,
      after: current,
      details: { ...details, ...this.pseudo.getDebugSnapshot() },
    });
  }

  flushPseudoDiagnostics(): void {
    for (const diagnostic of this.pseudo.drainDiagnostics()) {
      this.logDiagnostic(diagnostic.eventType, diagnostic.details);
    }
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
          this.pseudo.onRealCompositionEvent();
          this.machine.onCompositionStart();
          break;
        case "compositionupdate":
          this.pseudo.onRealCompositionEvent();
          this.machine.onCompositionUpdate(compositionEvent.data ?? "");
          break;
        case "compositionend":
          this.pseudo.onRealCompositionEvent();
          this.machine.onCompositionEnd(compositionEvent.data ?? "");
          break;
        case "beforeinput":
          this.machine.onBeforeInput({
            at: now,
            data: inputEvent.data,
            inputType: inputEvent.inputType,
            isComposing: inputEvent.isComposing,
          });
          this.pseudo.onBeforeInput({
            at: now,
            data: inputEvent.data,
            inputType: inputEvent.inputType,
            isComposing: inputEvent.isComposing || this.view.composing,
          });
          break;
        case "keydown":
          this.machine.onKeyDown({
            at: now,
            key: keyboardEvent.key,
            isComposing: keyboardEvent.isComposing,
            altKey: keyboardEvent.altKey,
            ctrlKey: keyboardEvent.ctrlKey,
            metaKey: keyboardEvent.metaKey,
            shiftKey: keyboardEvent.shiftKey,
            repeat: keyboardEvent.repeat,
          });
          this.pseudo.onKeyDown({
            at: now,
            key: keyboardEvent.key,
            isComposing: keyboardEvent.isComposing || this.view.composing,
            altKey: keyboardEvent.altKey,
            ctrlKey: keyboardEvent.ctrlKey,
            metaKey: keyboardEvent.metaKey,
            shiftKey: keyboardEvent.shiftKey,
            repeat: keyboardEvent.repeat,
          }, selectionSnapshot(this.view));
          break;
        case "blur":
          this.pseudo.onExternalFocusBoundary();
          break;
      }
      this.flushPseudoDiagnostics();
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
        ...(event.type === "keydown"
          ? {
              altKey: keyboardEvent.altKey,
              ctrlKey: keyboardEvent.ctrlKey,
              metaKey: keyboardEvent.metaKey,
              shiftKey: keyboardEvent.shiftKey,
              repeat: keyboardEvent.repeat,
            }
          : {}),
        ...this.pseudo.getDebugSnapshot(),
      },
    });

    queueMicrotask(() => this.captureAfter(entry));
  }

  private captureAfter(entry: DebugEntry): void {
    if (!this.controller.isDebugEnabled()) return;
    entry.after = snippet(this.view.state.doc, this.view.state.selection);
  }

}

function dispatchNoDocumentChange(view: EditorView, reason: string): void {
  view.dispatch({
    selection: view.state.selection,
    annotations: [Transaction.addToHistory.of(false), imeSuppression.of(reason)],
  });
}

export function createAtomicRepairTransaction(
  state: EditorState,
  decision: AtomicRepairDecision,
): Transaction {
  return state.update({
    changes: {
      from: decision.replace.from,
      to: decision.replace.to,
      insert: decision.insert,
    },
    selection: EditorSelection.cursor(decision.replace.from + decision.insert.length),
    annotations: [
      Transaction.userEvent.of("input.type"),
      imeSuppression.of("pseudo-atomic-repair"),
    ],
  });
}

function applyPseudoDecision(
  view: EditorView,
  tracker: KoreanImeViewTracker,
  decision: PseudoDecision,
): boolean {
  if (decision.kind === "allow") return false;

  if (decision.kind === "suppress-stale-delete") {
    if (decision.deleteSource === "shifted-native-tail") {
      tracker.logDiagnostic("shifted-native-tail-delete-detected", {
        attemptedRange: decision.range,
        repairRange: decision.repairRange,
        deletedText: decision.originalText,
        nativeTailText: decision.staleText,
      });
    }
    tracker.logDiagnostic("stale-rewrite-detected", {
      stage: "deleteContentBackward",
      deletedText: decision.originalText,
      staleText: decision.staleText,
      range: decision.range,
      repairRange: decision.repairRange,
      deleteSource: decision.deleteSource,
    });
    tracker.logDiagnostic("stale-rewrite-suppressed", { stage: "destructive-delete" });
    dispatchNoDocumentChange(view, "pseudo-stale-delete");
    return true;
  }

  if (decision.kind === "suppress-stale-replay") {
    tracker.logDiagnostic("stale-replay-suppressed", {
      data: decision.insert,
      destination: decision.destination,
      armedAt: decision.armedAt,
      armReason: decision.armReason,
    });
    dispatchNoDocumentChange(view, "pseudo-post-delete-stale-replay");
    return true;
  }

  if (
    decision.replace.from < 0 ||
    decision.replace.to < decision.replace.from ||
    decision.replace.to > view.state.doc.length
  ) {
    tracker.logDiagnostic("repair-aborted", { reason: "repair-range-invalid" });
    dispatchNoDocumentChange(view, "pseudo-repair-range-invalid");
    return true;
  }

  tracker.logDiagnostic("stale-rewrite-detected", {
    stage: "insertText",
    staleText: decision.staleText,
  });
  tracker.pseudo.commitAtomicRepair(decision);
  view.dispatch(createAtomicRepairTransaction(view.state, decision));
  tracker.logDiagnostic("atomic-repair", {
    restoredOriginalText: decision.originalText,
    discardedStaleText: decision.staleText,
    insertedTrustedText: decision.insert,
    intendedTextSource: decision.source,
    replace: decision.replace,
  });
  if (decision.source === "native-rewrite" || decision.source === "pending-intended-key") {
    tracker.logDiagnostic(decision.source, {
      insertedTrustedText: decision.insert,
      replace: decision.replace,
      nativeTailText: decision.nativeTailText,
    });
  }
  tracker.logDiagnostic("stale-rewrite-suppressed", { stage: "atomic-repair" });
  return true;
}

export function createKoreanImeEditorExtension(controller: ExtensionController): Extension {
  const trackerPlugin: ViewPlugin<KoreanImeViewTracker> = ViewPlugin.define(
    (view) => new KoreanImeViewTracker(view, controller),
  );

  const inputHandler = EditorView.inputHandler.of((view, from, _to, text, defaultInsert) => {
    if (!controller.isFixEnabled()) return false;

    const tracker = view.plugin(trackerPlugin);
    if (!tracker) return false;

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

    const main = view.state.selection.main;
    const realMoved = tracker.machine.getMovedComposition();
    if (realMoved) {
      const sourceStillPresent =
        realMoved.sourceFrom >= 0 &&
        realMoved.sourceTo <= view.state.doc.length &&
        view.state.sliceDoc(realMoved.sourceFrom, realMoved.sourceTo) === realMoved.text;
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

      if (decision.suppress) {
        tracker.logSuppression(decision.reason ?? "unknown", text, from);
        dispatchNoDocumentChange(view, decision.reason ?? "unknown");
        return true;
      }
    }

    const source = tracker.pseudo.getSourceGuard();
    const sourceStillPresent =
      source === undefined ||
      (source.range.from >= 0 &&
        source.range.to <= view.state.doc.length &&
        view.state.sliceDoc(source.range.from, source.range.to) === source.text);
    const pseudoSignal: PseudoTransactionSignal = {
      at: Date.now(),
      from: transactionFrom,
      to: transactionTo,
      insert: transactionInsert,
      deletedText:
        transactionFrom >= 0 && transactionTo >= transactionFrom
          ? view.state.sliceDoc(transactionFrom, transactionTo)
          : "",
      changeCount,
      docChanged: transaction.docChanged,
      userEvent: transaction.annotation(Transaction.userEvent),
      selectionBefore: { from: main.from, to: main.to },
      selectionAfter: {
        from: transaction.newSelection.main.from,
        to: transaction.newSelection.main.to,
      },
      sourceStillPresent,
    };
    const pseudoDecision = tracker.pseudo.evaluate(pseudoSignal);
    tracker.flushPseudoDiagnostics();
    return applyPseudoDecision(view, tracker, pseudoDecision);
  });

  return [Prec.highest(inputHandler), trackerPlugin];
}
