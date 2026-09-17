export const IPADOS_V019_REGRESSIONS = {
  confidenceCarry: {
    provenTail: "고",
    key: "ㅏ",
    nativeReplacement: "과",
    movedCases: [
      { key: "ㅂ", staleNative: "괍" },
      { key: "ㅎ", staleNative: "괗" },
    ],
  },
  bareModifier: {
    modifier: "Control",
    provenTail: "산",
    key: "ㅎ",
    staleNative: "삲",
  },
} as const;
