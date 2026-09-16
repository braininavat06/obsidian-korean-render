export const IPADOS_V015_SHIFTED_NATIVE_TAIL = {
  protectedSourceRange: { from: 55, to: 56 },
  protectedSourceText: "라",
  nativeTailRange: { from: 53, to: 54 },
  nativeTailText: "다",
  intendedRange: { from: 51, to: 54 },
  intendedText: "가나다",
  selection: 54,
  attemptedDeleteRange: { from: 54, to: 55 },
  deletedText: "다",
  continuationKey: "ㄹ",
  continuationData: "달",
} as const;

export const IPADOS_V015_POST_DELETE_NOOP_REPLAY = {
  selectedDocument: "가나가나다라",
  deleteUserEvent: "delete.selection",
  armAt: 35_637,
  noopAt: 35_643,
  replayAt: 35_646,
  replayData: "간",
  measuredReplayDelayMs: 9,
} as const;
