export const IPADOS_V010_HISTORY_BACKSPACE = {
  realDeleteOrder: [
    "keydown:Backspace",
    "beforeinput:deleteContentBackward",
    "input:deleteContentBackward",
    "keydown:Backspace:repeat=false",
    "selection-change:delete.backward",
    "cm-document-transaction:delete.backward",
    "native-replacement-or-replay",
  ],
  mutableRewind: {
    initial: "잇",
    replacements: ["이", "ㅇ", ""],
    spillText: "앞",
    staleReplay: "니",
  },
  movedBackspace: {
    nativeTail: "사",
    deletedDocumentText: "나",
    staleReplay: "사",
  },
  history: {
    nativeTail: "과",
    key: "ㅂ",
    deletedDocumentText: "해",
    staleInsert: "괍",
  },
} as const;
