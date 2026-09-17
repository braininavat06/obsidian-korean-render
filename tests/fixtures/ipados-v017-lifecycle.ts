export const IPADOS_V017_LIFECYCLE = {
  handoff: {
    initialKey: "ㅅ",
    exactDeletedText: "ㅅ",
    replacementText: "세",
    movedKey: "ㅁ",
    staleResults: ["셈", "세므"],
  },
  backspace: {
    before: "벗",
    validRewind: "버",
    staleResults: ["멉", "럼", "덜"],
  },
} as const;
