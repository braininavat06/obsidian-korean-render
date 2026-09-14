# Korean Render

Obsidian Mobile의 기본 Live Preview를 그대로 유지하면서, iOS/iPadOS Korean IME의 오래된 composition 문자열이 커서 이동 뒤 새 위치에 다시 삽입되는 경우만 매우 보수적으로 차단하는 초소형 플러그인입니다.

- 별도 편집기, textarea, hotkey가 없습니다.
- Live Preview의 렌더링, 이미지, wikilink, callout, embed를 건드리지 않습니다.
- 데스크톱과 Android에서는 자동 workaround가 꺼져 있습니다. Debug logging은 원인 확인을 위해 어느 플랫폼에서나 켤 수 있습니다.
- `@codemirror/*`는 빌드 결과에 포함하지 않고 Obsidian이 제공하는 인스턴스를 사용합니다.

## 조사 결과와 가장 가능성 높은 원인

CodeMirror 6의 정상적인 composition 흐름은 대체로 다음과 같습니다.

1. `compositionstart`가 composition 상태를 엽니다.
2. `compositionupdate`와 `beforeinput`/`input`이 조합 중 문자열을 갱신합니다. `beforeinput.inputType`은 보통 `insertCompositionText`이며 `data`에 현재 문자열이 옵니다.
3. CM이 contenteditable DOM의 변경을 읽어 CodeMirror transaction으로 변환합니다. 조합 입력은 `Transaction.userEvent`가 `input.type.compose`, 첫 변경은 `input.type.compose.start`가 됩니다.
4. `compositionend`가 상태를 닫습니다. CM은 브라우저가 `compositionend` 뒤에 DOM 변경을 늦게 보내는 경우를 위해 짧은 pending-change 구간도 둡니다.

[W3C Input Events Level 2](https://www.w3.org/TR/input-events-2/)에서 `beforeinput`은 편집 전에 의도와 `inputType`/`data`를 알리고 `input`은 편집 뒤 DOM 변경을 알리는 event로 정의됩니다. `insertCompositionText`는 composition 문자열 교체, `deleteContentBackward`는 caret 앞 삭제를 뜻합니다. [`KeyboardEvent.isComposing`](https://w3c.github.io/uievents/#dom-keyboardevent-iscomposing)는 composition session 안의 key event인지 나타내도록 정의되지만, 아래 iOS Korean 구현 사례처럼 실제 값과 composition event 발생 여부는 항상 신뢰할 수 있지 않습니다.

CM6는 공식적으로 [`EditorView.composing`과 `compositionStarted`](https://codemirror.net/docs/ref/#view.EditorView.composing), [`EditorView.inputHandler`](https://codemirror.net/docs/ref/#view.EditorView^inputHandler), [`ViewUpdate.transactions`](https://codemirror.net/docs/ref/#view.ViewUpdate.transactions)를 제공합니다. 최신 입력 구현도 iOS에서 일부 key의 기본 동작을 먼저 허용한 뒤 처리하고, Safari의 잘못된 event order와 늦은 composition DOM mutation을 별도로 보정합니다. 자세한 코드는 [CodeMirror input.ts](https://github.com/codemirror/view/blob/main/src/input.ts)와 [domchange.ts](https://github.com/codemirror/view/blob/main/src/domchange.ts)에 있습니다.

iOS Korean IME는 입력 방식에 따라 composition 이벤트를 전혀 보내지 않고 `beforeinput(deleteContentBackward → insertText)` 쌍만 보내며 `isComposing`도 `false`일 수 있다는 재현 보고가 있습니다. [Lexical의 iOS Korean IME 이슈](https://github.com/facebook/lexical/issues/5841)가 이 순서를 실제 iOS trace로 설명합니다. 외부 키보드가 연결된 iPad의 IME/커서 문제도 [CodeMirror upstream에 별도로 보고](https://github.com/codemirror/dev/issues/921)되어 있습니다.

또한 CM upstream은 과거에 “composition 중 브라우저가 focused text node로 내용을 옮길 때 생기는 중복”을 수정했고([6.18.1 changelog](https://github.com/codemirror/view/blob/main/CHANGELOG.md#6181-2023-09-11)), 2025년 말 이후 composition DOM 보존을 크게 개선했습니다. 하지만 Obsidian SDK가 요구하는 CM과 실제 앱에 내장된 CM의 버전은 사용 중인 Obsidian 릴리스에 의해 결정됩니다. 이 플러그인이 새 CM을 중복 번들링해 교체하면 오히려 state/view 인스턴스 충돌이 생길 수 있으므로 그렇게 하지 않습니다.

현재 보고된 증상에 가장 잘 맞는 순서는 다음과 같습니다. 이것은 실제 해당 iPad 로그가 오기 전까지는 **검증된 단일 원인이 아니라 가장 좁은 가설**입니다.

1. 마지막 한글 음절이 문서에는 이미 반영됐지만 WebKit/IME의 marked composition은 아직 살아 있습니다.
2. 방향키 `keydown` 또는 터치가 CM selection transaction(`select`/`select.pointer`)을 새 위치로 이동시킵니다. 일부 iOS Korean IME에서는 `KeyboardEvent.isComposing`이 이때도 믿을 수 없습니다.
3. native IME에는 이전 DOM composition range가 남아 있습니다. 새 위치의 첫 입력 또는 Backspace가 그 stale range를 다시 내보냅니다.
4. `beforeinput`/`input`과 DOM mutation이 발생하고 CM은 이를 정상 입력처럼 읽어 새 selection에 `input.type.compose` transaction을 만듭니다.
5. 결과적으로 이전 위치의 문자열은 그대로인데 동일 문자열이 새 위치에도 실제 문서 데이터로 삽입됩니다.

## 선택한 workaround

공식 `EditorView.inputHandler`에서 기본 transaction을 먼저 검사하고, 아래 조건이 **전부** 맞는 한 번의 입력만 문서에 들어가기 전에 무시합니다.

- Obsidian이 iOS/iPadOS 앱이며 설정이 켜져 있음
- 명시적인 `compositionstart/update`로 추적한 완성형 한글 음절 1자가 있었음
- composition이 활성 상태일 때 collapsed cursor가 `select` 또는 `select.pointer` transaction으로 이동함
- 이전 composition 문자열이 원래 커서 바로 앞에 아직 그대로 존재함
- 이동 후 1초 이내, 관련 `beforeinput`/`keydown` 뒤 150ms 이내임
- 새 위치의 기본 CM transaction이 단일·순수 insertion이고, insertion 문자열이 이전 composition과 정확히 같음
- transaction origin이 정확히 `input.type.compose`임 (`input.type.compose.start`는 제외)
- `beforeinput`이 같은 문자열의 `insertCompositionText`이거나, 명시적인 Backspace `keydown`과 `deleteContentBackward` 쌍임
- selection range, multiple change, replacement, undo/redo, 일반 `insertText` 중 하나도 아님

차단 시 문서 변경 transaction을 만들지 않으므로 undo history에 “삽입 후 삭제”가 남지 않습니다. selection도 현재 위치 그대로 유지하고, correction transaction은 `addToHistory: false`입니다.

### 검토했지만 사용하지 않은 방식

- **강제 composition commit:** 공개 CM6 API에는 native IME composition을 commit하는 명령이 없습니다. `EditorView.composing`/`compositionStarted`는 읽기 전용입니다. blur/focus, 합성 `compositionend`, 내부 `inputState` 변경은 키보드·selection을 깨뜨릴 수 있어 사용하지 않았습니다.
- **사후 문자열 삭제:** undo history 및 의도적 반복 입력을 손상시킬 수 있어 사용하지 않았습니다.
- **Live Preview 렌더링 정지:** decorations, embeds, 다른 플러그인까지 지연시키므로 사용하지 않았습니다.

## 안전성 및 알려진 한계

이 플러그인은 “같은 글자가 나왔다”만으로 삭제하지 않습니다. 새 composition이 시작됐거나, 정상 영어/Backspace/selection replacement이거나, source 문자열 확인에 실패하거나, event 순서가 조금이라도 모호하면 아무것도 고치지 않고 Debug log만 남깁니다.

그 결과 다음 경우에는 버그가 남을 수 있습니다.

- 해당 iPad Korean IME가 `compositionstart/update/end`를 전혀 보내지 않는 경우
- stale 문자열이 완성형 한글 음절 1자가 아닌 Jamo 또는 여러 글자인 경우
- stale insertion과 실제 첫 입력이 하나의 replacement/multi-change transaction에 합쳐진 경우
- event와 transaction 간 지연이 보수적 시간 제한을 넘는 경우
- 실제 trace의 `inputType`/`userEvent`가 예상과 다른 경우

이 한계는 의도적입니다. 실제 iPad trace 없이 위 경우까지 추측해 자동 삭제하면 정상 입력이나 undo 데이터를 잃을 가능성이 있습니다.

## 설치

### BRAT

Korean Render의 GitHub release에는 BRAT이 요구하는 `manifest.json`과 `main.js`가 첨부됩니다. 이 플러그인은 CSS를 사용하지 않으므로 `styles.css`는 없습니다.

1. Obsidian Community plugins에서 **BRAT**을 설치하고 활성화합니다.
2. BRAT 설정 또는 Command Palette에서 **Add a beta plugin for testing**을 실행합니다.
3. 다음 repository URL을 입력하고 latest version을 선택합니다.

```text
https://github.com/braininavat06/obsidian-korean-render
```

4. 설치가 끝나면 Community plugins에서 **Korean Render**를 활성화합니다.

BRAT 1.1.0 이상은 GitHub release를 기준으로 설치합니다. release tag, release name, `manifest.json`의 version은 모두 같은 semantic version을 사용합니다.

### 수동 설치

Release의 `main.js`와 `manifest.json`을 내려받거나, source checkout에서 `npm run build` 후 생성되는 폴더를 그대로 복사합니다.

```text
dist/korean-render/
  main.js
  manifest.json
```

복사 위치:

```text
<Vault>/.obsidian/plugins/korean-render/
```

그 뒤 Obsidian을 다시 시작하거나 community plugins를 새로고침하고 **Korean Render**를 활성화합니다.

Settings에는 다음 두 항목만 있습니다.

1. **Enable Korean Render** — 기본 ON, 자동 workaround는 iOS/iPadOS에서만 동작
2. **Debug logging** — 기본 OFF

Debug OFF에서는 snippet 생성, JSON 직렬화, ring buffer 기록을 수행하지 않습니다.

## iPad 재현 테스트 절차

먼저 중요한 노트가 아닌 새 테스트 노트에서 수행하십시오.

1. iPadOS의 Apple 기본 Korean IME와 외부 Bluetooth 키보드를 연결합니다.
2. Obsidian Mobile에서 편집 모드를 Live Preview로 두고 플러그인의 두 설정을 기본값(Enabled ON, Debug OFF)으로 둡니다.
3. `나는 한글을 쓴다`를 입력하되 마지막 `다`를 입력한 직후 기다리지 않습니다.
4. 즉시 왼쪽 방향키를 여러 번 눌러 `나는 |한글을 쓴다` 위치로 이동합니다.
5. 곧바로 한글 첫 키를 입력합니다. 이전 `다` 또는 조합 문자열이 새 위치에 생기지 않는지 확인합니다.
6. 3~4를 반복하고 새 위치에서 곧바로 Backspace를 눌러 같은 현상을 확인합니다.
7. 같은 절차를 화면 터치로 cursor를 옮겨 반복합니다.
8. 정상 한글 연속 입력, 영어 입력, 의도적으로 같은 글자 재입력, 범위 선택 후 입력, 빠른 방향키 연타를 확인합니다.
9. Undo/redo를 여러 번 실행해 한 번의 정상 입력이 한 번의 history step으로 유지되고 cursor/selection이 깨지지 않는지 확인합니다.

## 문제가 남을 때 보낼 로그

1. Settings에서 **Debug logging**을 ON으로 켭니다. 토글을 켠 이후의 최대 500개 이벤트만 메모리에 보관합니다.
2. 다른 입력을 최소화하고 위 재현 절차를 한 번 수행합니다.
3. 문제가 생긴 직후 Command Palette에서 **Korean Render: Copy debug log**를 실행합니다.
4. 복사된 JSON Lines 전체를 이 프로젝트의 이슈나 개발자에게 보냅니다. 성공 사례 한 번과 실패 사례 한 번을 각각 보내면 비교가 가장 쉽습니다.
5. 함께 적어 주면 좋은 정보: Obsidian 버전, iPadOS 버전, iPad 모델, 키보드 모델, 두벌식/세벌식 등 Korean 입력 방식, 방향키인지 터치인지, 첫 동작이 문자 입력인지 Backspace인지.

각 event에는 timestamp, event type, `data`, `inputType`, `isComposing`, key 정보, selection from/to, CM의 composition 상태, transaction origin/change, 직전·직후 cursor 주변 최대 약 48자만 들어갑니다. 노트 제목과 전체 노트는 기록하지 않습니다. 민감한 문장이 cursor 가까이에 있다면 전송 전에 해당 snippet을 지우십시오.

## 개발 및 검증

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

상태 판정은 [`src/ime-state-machine.ts`](src/ime-state-machine.ts)의 DOM 독립 순수 state machine에 있고, 정상 한글/영어/Backspace, stale duplicate, 의도적 반복, undo/redo, selection range, 빠른 방향키, touch 이동을 unit test로 검증합니다.
