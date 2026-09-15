import {
  Annotation,
  EditorSelection,
  Prec,
  Transaction,
  type EditorState,
  type Extension,
  type Text,
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
  isHangulInputKey,
  type AtomicRepairDecision,
  type PseudoDecision,
  type PseudoTransactionSignal,
} from "./pseudo-composition-state-machine";

export interface ExtensionController {
  isFixEnabled(): boolean;
  isDebugEnabled(): boolean;
  isExperimentalImeResetEnabled(): boolean;
  readonly debugLog: DebugRingBuffer;
}

export const imeSuppression = Annotation.define<string>();

interface ScrollSnapshot {
  editorLeft: number;
  editorTop: number;
  windowX: number;
  windowY: number;
  visualViewportHeight: number | null;
}

interface ImeResetAttempt {
  startedAt: number;
  selection: EditorSelection;
  doc: Text;
  scrollBefore: ScrollSnapshot;
  frame: number;
}

interface ImeResetProbe {
  focusedAt: number;
  firstKoreanKey?: string;
  destructiveDeleteObserved: boolean;
}

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
  private resetAttempt: ImeResetAttempt | undefined;
  private resetProbe: ImeResetProbe | undefined;

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
        if (this.controller.isExperimentalImeResetEnabled()) {
          this.requestExperimentalReset();
        } else {
          this.logDiagnostic("reset-attempt", {
            "reset-method": "none-safe-public-api",
            "reset-result": "unavailable-atomic-guard-armed",
          });
        }
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

  destroy(): void {
    if (this.resetAttempt) cancelAnimationFrame(this.resetAttempt.frame);
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

    this.traceResetProbeDomEvent(event, now);

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
          });
          break;
        case "blur":
          if (!this.resetAttempt) {
            this.pseudo.onExternalFocusBoundary();
            this.resetProbe = undefined;
          }
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

  traceResetTransaction(signal: PseudoTransactionSignal, decision: PseudoDecision): void {
    const probe = this.resetProbe;
    if (!probe?.firstKoreanKey) return;
    const stage = signal.insert === "" ? "cm-delete" : "cm-insert";
    if (stage === "cm-delete") probe.destructiveDeleteObserved = true;
    this.logDiagnostic("ime-reset-first-input-trace", {
      stage,
      key: probe.firstKoreanKey,
      from: signal.from,
      to: signal.to,
      insertedText: signal.insert,
      deletedText: signal.deletedText,
      decision: decision.kind,
      sourceStillPresent: signal.sourceStillPresent,
      "deleteContentBackward-observed": probe.destructiveDeleteObserved,
      "reset-to-input-latency-ms": Date.now() - probe.focusedAt,
    });
    if (stage === "cm-insert") this.resetProbe = undefined;
  }

  private requestExperimentalReset(): void {
    if (this.resetAttempt) {
      this.resetAttempt.selection = this.view.state.selection;
      this.resetAttempt.doc = this.view.state.doc;
      this.logDiagnostic("ime-reset-attempt", {
        "reset-method": "contentDOM-blur-rAF-focus",
        "reset-result": "coalesced-selection-update",
        "selection-before": selectionSnapshot(this.view),
      });
      return;
    }

    const startedAt = Date.now();
    const selection = this.view.state.selection;
    const scrollBefore = this.captureScroll();
    this.logDiagnostic("ime-reset-attempt", {
      "reset-method": "contentDOM-blur-rAF-focus",
      "reset-result": "scheduled",
      "selection-before": { from: selection.main.from, to: selection.main.to },
      "scroll-before": scrollBefore,
      "editor-had-focus": this.view.hasFocus,
    });

    if (!this.view.hasFocus) {
      this.logDiagnostic("ime-reset-focus", {
        blur: false,
        focus: false,
        "selection-before": { from: selection.main.from, to: selection.main.to },
        "selection-after": selectionSnapshot(this.view),
        "reset-latency-ms": 0,
        "reset-success-candidate": false,
        reason: "editor-not-focused",
      });
      return;
    }

    const attempt: ImeResetAttempt = {
      startedAt,
      selection,
      doc: this.view.state.doc,
      scrollBefore,
      frame: 0,
    };
    this.resetAttempt = attempt;
    this.view.contentDOM.blur();
    this.logDiagnostic("ime-reset-blur", {
      blur: true,
      focus: false,
      "selection-before": { from: attempt.selection.main.from, to: attempt.selection.main.to },
      "active-element-after-blur": document.activeElement?.tagName ?? null,
    });
    attempt.frame = requestAnimationFrame(() => this.finishExperimentalReset(attempt));
  }

  private finishExperimentalReset(attempt: ImeResetAttempt): void {
    if (this.resetAttempt !== attempt) return;
    this.resetAttempt = undefined;
    let focusMethod = "focus-prevent-scroll";
    try {
      this.view.contentDOM.focus({ preventScroll: true });
    } catch {
      focusMethod = "focus-fallback";
      this.view.contentDOM.focus();
    }

    const documentUnchanged = this.view.state.doc.eq(attempt.doc);
    const selectionChanged = !this.view.state.selection.eq(attempt.selection);
    let selectionRestored = false;
    if (documentUnchanged && selectionChanged) {
      this.view.dispatch(createSelectionRestoreTransaction(this.view.state, attempt.selection));
      selectionRestored = true;
    }

    const focusedAt = Date.now();
    const resetSuccessCandidate = this.view.hasFocus && documentUnchanged;
    if (resetSuccessCandidate) {
      this.pseudo.onResetSuccessCandidate();
      this.resetProbe = {
        focusedAt,
        destructiveDeleteObserved: false,
      };
    } else {
      this.pseudo.onExternalFocusBoundary();
      this.resetProbe = undefined;
    }
    this.logDiagnostic("ime-reset-focus", {
      blur: true,
      focus: this.view.hasFocus,
      "focus-method": focusMethod,
      "selection-before": { from: attempt.selection.main.from, to: attempt.selection.main.to },
      "selection-after": selectionSnapshot(this.view),
      "selection-restored": selectionRestored,
      "document-unchanged": documentUnchanged,
      "scroll-before": attempt.scrollBefore,
      "scroll-after": this.captureScroll(),
      "reset-latency-ms": focusedAt - attempt.startedAt,
      "reset-success-candidate": resetSuccessCandidate,
      "native-ime-reset-confirmed": false,
    });
  }

  private traceResetProbeDomEvent(event: Event, at: number): void {
    const probe = this.resetProbe;
    if (!probe) return;
    if (event.type === "keydown") {
      const keyboardEvent = event as KeyboardEvent;
      if (isHangulInputKey(keyboardEvent.key) && !keyboardEvent.isComposing &&
          !keyboardEvent.altKey && !keyboardEvent.ctrlKey && !keyboardEvent.metaKey) {
        probe.firstKoreanKey = keyboardEvent.key;
        this.logDiagnostic("ime-reset-first-input-trace", {
          stage: "keydown",
          key: keyboardEvent.key,
          "reset-to-input-latency-ms": at - probe.focusedAt,
        });
      } else if (keyboardEvent.key.length === 1 || ["Enter", "Tab", "Escape", "Backspace", "Delete"].includes(keyboardEvent.key)) {
        this.logDiagnostic("ime-reset-first-input-trace", {
          stage: "probe-ended-by-boundary",
          key: keyboardEvent.key,
        });
        this.resetProbe = undefined;
      }
      return;
    }
    if (!probe.firstKoreanKey) return;
    if (event.type === "beforeinput" || event.type === "input") {
      const inputEvent = event as InputEvent;
      if (inputEvent.inputType === "deleteContentBackward") {
        probe.destructiveDeleteObserved = true;
      }
      this.logDiagnostic("ime-reset-first-input-trace", {
        stage: event.type,
        key: probe.firstKoreanKey,
        inputType: inputEvent.inputType,
        data: inputEvent.data,
        "deleteContentBackward-observed": probe.destructiveDeleteObserved,
        "reset-to-input-latency-ms": at - probe.focusedAt,
      });
    }
  }

  private captureScroll(): ScrollSnapshot {
    return {
      editorLeft: this.view.scrollDOM.scrollLeft,
      editorTop: this.view.scrollDOM.scrollTop,
      windowX: window.scrollX,
      windowY: window.scrollY,
      visualViewportHeight: window.visualViewport?.height ?? null,
    };
  }
}

function dispatchNoDocumentChange(view: EditorView, reason: string): void {
  view.dispatch({
    selection: view.state.selection,
    annotations: [Transaction.addToHistory.of(false), imeSuppression.of(reason)],
  });
}

export function createSelectionRestoreTransaction(
  state: EditorState,
  selection: EditorSelection,
): Transaction {
  return state.update({
    selection,
    annotations: [
      Transaction.addToHistory.of(false),
      imeSuppression.of("experimental-ime-reset-selection-restore"),
    ],
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
    tracker.logDiagnostic("stale-rewrite-detected", {
      stage: "deleteContentBackward",
      deletedText: decision.originalText,
      staleText: decision.staleText,
      range: decision.range,
    });
    tracker.logDiagnostic("stale-rewrite-suppressed", { stage: "destructive-delete" });
    dispatchNoDocumentChange(view, "pseudo-stale-delete");
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
      userEvent: transaction.annotation(Transaction.userEvent),
      selectionBefore: { from: main.from, to: main.to },
      sourceStillPresent,
    };
    const pseudoDecision = tracker.pseudo.evaluate(pseudoSignal);
    tracker.traceResetTransaction(pseudoSignal, pseudoDecision);
    return applyPseudoDecision(view, tracker, pseudoDecision);
  });

  return [Prec.highest(inputHandler), trackerPlugin];
}
