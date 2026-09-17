export const IPADOS_V018_REGRESSIONS = {
  directMovedInsert: {
    source: "라",
    key: "ㄱ",
    nativeInsert: "락",
    trustedInsert: "ㄱ",
  },
  backspaceRewind: {
    before: "해물과",
    firstDeleted: "과",
    firstReplacement: "고",
    protectedExistingText: "물",
    staleReplay: "묽",
  },
  synchronizedContinuation: {
    initial: "ㅎ",
    firstSyllable: "호",
    key: "ㅏ",
    nativeReplacement: "화",
    expectedPhrase: "화려강산",
  },
} as const;
