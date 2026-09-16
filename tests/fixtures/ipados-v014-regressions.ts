export const IPADOS_V014_NATIVE_TAIL_REGRESSION = {
  initialDocument: "가나다라",
  firstMovePath: [3, 2],
  firstRepair: [
    { key: "ㄱ", nativeData: "락", expected: "ㄱ" },
    { key: "ㅏ", nativeData: "라가", expected: "가" },
    { key: "ㄴ", nativeData: "간", expected: "간" },
    { key: "ㅏ", nativeData: "가나", expected: "가나" },
  ],
  secondMovePath: [3, 2],
  secondRepair: [
    { key: "ㄱ", nativeData: "낙", expected: "ㄱ" },
    { key: "ㅏ", nativeData: "나가", expected: "가" },
    { key: "ㄴ", nativeData: "간", expected: "간" },
    { key: "ㅏ", nativeData: "가나", expected: "가나" },
  ],
  expectedSecondInsertion: "가나",
} as const;

export const IPADOS_V014_POST_DELETE_REPLAY = {
  selectedDocument: "가나ㄱ가나다라",
  key: "Backspace",
  transactionUserEvent: "delete.selection",
  measuredReplayDelayMs: 10,
  replayData: "간",
} as const;
