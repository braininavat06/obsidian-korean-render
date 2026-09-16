/** Anonymized, cursor-local excerpt of the v0.1.6 physical-keyboard trace. */
export const IPADOS_V016_SINGLE_REWRITE = {
  initial: {
    keyAt: 32_055,
    inputAt: 32_057,
    key: "ㄲ",
    text: "ㄲ",
    range: { from: 71, to: 72 },
  },
  rewrite: {
    keyAt: 32_099,
    deleteAt: 32_108,
    insertAt: 32_111,
    key: "ㅏ",
    deletedText: "ㄲ",
    deletedRange: { from: 71, to: 72 },
    replacementText: "까",
    replacementRange: { from: 71, to: 72 },
  },
  cursorPath: [71, 70, 69, 68],
  staleAttempt: {
    key: "ㅇ",
    destination: 68,
    deletedText: "이",
    deletedRange: { from: 67, to: 68 },
    nativeData: "깡",
  },
  laterNativeContinuation: ["까오", "왜"],
} as const;
