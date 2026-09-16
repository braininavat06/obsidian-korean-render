export interface TrainingRewriteFixture {
  key: string;
  previous: string;
  inserted: string;
  from: number;
  to: number;
}

export interface PostMoveRewriteFixture {
  key: string;
  inputData: string;
  expectedInsert: string;
  expectedSource: "derived" | "native-rewrite";
  expectedDocument: string;
}

export interface IpadTraceFixture {
  name: string;
  resetEnabled: boolean;
  observedStaleCycles: number;
  observedPendingRepairs: number;
  initialDocument: string;
  training: TrainingRewriteFixture[];
  movePath: number[];
  sourceText: string;
  postMove: PostMoveRewriteFixture[];
  reset?: {
    focusLatenciesMs: number[];
    resetToFirstInputMs: number[];
    selectionsPreserved: boolean;
    scrollPreserved: boolean;
    firstInputDeleteObserved: boolean;
    firstInputData: string[];
  };
}

// Distilled and anonymized from the complete v0.1.3 iPadOS + Bluetooth-keyboard
// JSONL logs. Sequence numbers and the short test text are retained so these
// fixtures continue to describe the native event ordering that exposed the bug.
export const IPADOS_V013_A_OFF: IpadTraceFixture = {
  name: "A/OFF seq 2052-2211",
  resetEnabled: false,
  observedStaleCycles: 8,
  observedPendingRepairs: 4,
  initialDocument: "가나다",
  training: [
    { key: "ㅏ", previous: "ㄱ", inserted: "가", from: 0, to: 1 },
    { key: "ㄴ", previous: "가", inserted: "간", from: 0, to: 1 },
    { key: "ㅏ", previous: "간", inserted: "가나", from: 0, to: 1 },
    { key: "ㄷ", previous: "나", inserted: "낟", from: 1, to: 2 },
    { key: "ㅏ", previous: "낟", inserted: "나다", from: 1, to: 2 },
  ],
  movePath: [2, 1],
  sourceText: "다",
  postMove: [
    { key: "ㄱ", inputData: "닥", expectedInsert: "ㄱ", expectedSource: "derived", expectedDocument: "가ㄱ나다" },
    { key: "ㅏ", inputData: "다가", expectedInsert: "가", expectedSource: "derived", expectedDocument: "가가나다" },
    { key: "ㄴ", inputData: "간", expectedInsert: "간", expectedSource: "native-rewrite", expectedDocument: "가간나다" },
    { key: "ㅏ", inputData: "가나", expectedInsert: "가나", expectedSource: "native-rewrite", expectedDocument: "가가나나다" },
    { key: "ㄷ", inputData: "낟", expectedInsert: "낟", expectedSource: "native-rewrite", expectedDocument: "가가낟나다" },
    { key: "ㅏ", inputData: "나다", expectedInsert: "나다", expectedSource: "native-rewrite", expectedDocument: "가가나다나다" },
    { key: "ㄹ", inputData: "달", expectedInsert: "달", expectedSource: "native-rewrite", expectedDocument: "가가나달나다" },
    { key: "ㅏ", inputData: "다라", expectedInsert: "다라", expectedSource: "native-rewrite", expectedDocument: "가가나다라나다" },
  ],
};

export const IPADOS_V013_B_ON: IpadTraceFixture = {
  name: "B/ON seq 2255-2650",
  resetEnabled: true,
  observedStaleCycles: 22,
  observedPendingRepairs: 16,
  initialDocument: "가나다라",
  training: [
    { key: "ㅏ", previous: "ㄱ", inserted: "가", from: 0, to: 1 },
    { key: "ㄴ", previous: "가", inserted: "간", from: 0, to: 1 },
    { key: "ㅏ", previous: "간", inserted: "가나", from: 0, to: 1 },
    { key: "ㄷ", previous: "나", inserted: "낟", from: 1, to: 2 },
    { key: "ㅏ", previous: "낟", inserted: "나다", from: 1, to: 2 },
    { key: "ㄹ", previous: "다", inserted: "달", from: 2, to: 3 },
    { key: "ㅏ", previous: "달", inserted: "다라", from: 2, to: 3 },
  ],
  movePath: [3, 2],
  sourceText: "라",
  reset: {
    focusLatenciesMs: [15, 4, 9, 8],
    resetToFirstInputMs: [249, 410],
    selectionsPreserved: true,
    scrollPreserved: true,
    firstInputDeleteObserved: true,
    firstInputData: ["락", "락"],
  },
  postMove: [
    { key: "ㄱ", inputData: "락", expectedInsert: "ㄱ", expectedSource: "derived", expectedDocument: "가나ㄱ다라" },
    { key: "ㅏ", inputData: "라가", expectedInsert: "가", expectedSource: "derived", expectedDocument: "가나가다라" },
    { key: "ㄴ", inputData: "간", expectedInsert: "간", expectedSource: "native-rewrite", expectedDocument: "가나간다라" },
    { key: "ㅏ", inputData: "가나", expectedInsert: "가나", expectedSource: "native-rewrite", expectedDocument: "가나가나다라" },
    { key: "ㄷ", inputData: "낟", expectedInsert: "낟", expectedSource: "native-rewrite", expectedDocument: "가나가낟다라" },
    { key: "ㅏ", inputData: "나다", expectedInsert: "나다", expectedSource: "native-rewrite", expectedDocument: "가나가나다다라" },
    { key: "ㄹ", inputData: "달", expectedInsert: "달", expectedSource: "native-rewrite", expectedDocument: "가나가나달다라" },
    { key: "ㅏ", inputData: "다라", expectedInsert: "다라", expectedSource: "native-rewrite", expectedDocument: "가나가나다라다라" },
  ],
};
