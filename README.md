# Korean Render

Obsidian Mobile의 기본 Live Preview를 그대로 유지하면서, iOS/iPadOS Korean IME가 커서 이동 뒤 이전 한글 조합 상태를 새 위치에 재사용해 문서를 손상시키는 경로를 매우 보수적으로 막는 플러그인입니다.

- 별도 editor, `textarea`, `input`, hotkey가 없습니다.
- Live Preview, wikilink, callout, embed, 다른 CodeMirror extension을 바꾸지 않습니다.
- workaround는 Obsidian iOS/iPadOS 앱에서만 활성화됩니다. Debug logging은 원인 확인을 위해 다른 플랫폼에서도 켤 수 있습니다.
- 정상 composition event가 오는 환경의 v0.1.0 경로를 그대로 유지합니다.
- `@codemirror/*`를 bundle하지 않고 Obsidian이 제공하는 인스턴스를 사용합니다.

> v0.1.2 실기기 로그에서는 native stale state가 atomic repair 뒤와 11초 이상의 정지 뒤에도 지속되고, 일부 입력 유실 및 guard 이탈이 확인되었습니다. v0.1.3의 reset 기능은 이 현상을 실기에서 비교하기 위한 **기본 OFF 진단 실험**이며, production-safe fix나 native IME reset 보장을 의미하지 않습니다.

## v0.1.3

v0.1.3은 기존 repair를 유지하면서 native IME stale state를 focus cycle로 종료할 수 있는지 검증하기 위한 진단 release입니다.

- **Experimental IME reset on cursor move** 설정을 추가했습니다. 기본값은 OFF이며 iOS/iPadOS에서만 동작합니다.
- 최소 두 번의 Korean pseudo-composition rewrite가 확인된 뒤 selection이 active range 밖으로 이동한 경우에만 `blur → requestAnimationFrame → focus({preventScroll:true})`를 실행합니다.
- 이 focus cycle이 native IME stale state를 실제로 종료한다고 가정하지 않습니다. reset 뒤 첫 Korean 입력의 delete/rewrite trace를 OFF/ON으로 비교해야 합니다.
- reset 전 CM selection과 scroll/visual viewport를 기록하고, selection이 바뀌면 document/history 변경 없는 공식 CM dispatch로 복원합니다.
- 증명할 수 없는 stale insertion에서도 신뢰 가능한 단일 Korean `keydown.key`를 `pending-intended-key`로 보존해 사용자 입력이 조용히 사라지지 않도록 수정했습니다. 임의 Hangul composition은 구현하지 않습니다.
- atomic repair 뒤 selection이 다시 이동하면 이전 `intended.range`를 폐기하고 새 destination을 guard하도록 수정했습니다.
- 단순 1.5초 경과로 stale 가능성을 종료하지 않고, Space/Enter·비한글 입력·입력 모드 전환·외부 focus boundary 같은 명시적인 session boundary를 사용합니다.

## 확인된 root cause

외장 Bluetooth keyboard를 사용하는 실제 iPadOS 환경에서는 일반적인 IME composition 신호가 하나도 오지 않았습니다.

- `compositionstart`, `compositionupdate`, `compositionend`: 없음
- `KeyboardEvent.isComposing`: 항상 `false`
- `EditorView.composing`, `compositionStarted`: 항상 `false`
- 한글 조합은 `deleteContentBackward → insertText` rewrite 반복으로 구현됨

확인된 실패 순서는 다음과 같습니다.

1. 사용자가 마지막 음절 `휴`까지 입력합니다.
2. ArrowUp 두 번으로 CM selection이 `57 → 54 → 41`로 이동합니다.
3. 새 위치에서 실제 key `ㅇ`을 입력합니다.
4. iOS IME가 새 위치의 정상 문자 `[40,41]`을 `deleteContentBackward`로 삭제합니다.
5. 이전 위치의 stale `휴`와 새 key를 합친 `흉`을 `insertText`로 보냅니다.
6. 다음 key `ㅣ`에서도 `흉`을 지운 뒤 `휴이`를 넣어 stale `휴`를 계속 재사용합니다.

따라서 문제는 duplicate insertion이 아니라, native IME가 composition event 없이 유지한 pseudo-composition을 새 selection에 적용하는 **destructive stale rewrite**입니다.

## pseudo-composition state machine

[`src/pseudo-composition-state-machine.ts`](src/pseudo-composition-state-machine.ts)는 DOM이나 Obsidian에 의존하지 않는 순수 state machine입니다. 다음 증거를 함께 사용합니다.

1. `keydown.key`가 실제 Hangul Jamo/음절이고 modifier용 key가 아님
2. `beforeinput(deleteContentBackward)`와 한 개 range를 지우는 `input.type` transaction
3. 최대 80ms 안의 `beforeinput(insertText)`와 같은 위치의 단일 insertion transaction
4. 삭제 문자열이 직전에 추적한 마지막 Hangul range/text와 정확히 일치
5. insertion이 이전 음절과 초성·중성 또는 Jamo 관계로 연결됨
6. 위 rewrite가 최소 두 번 연속 확인됨
7. 명시적인 session boundary가 발생하기 전에 `select`/`select.pointer` transaction으로 실제 selection이 active tail 밖으로 이동
8. source Hangul이 원래 range에 여전히 존재하고, 목적 selection은 collapsed 상태임
9. Space, Enter, 영어, 숫자, 기호, 한영 전환, 외부 blur, 실제 composition 시작, range selection, undo/redo가 없었음

처음 Hangul insertion 한 번이나 rewrite 한 번만으로는 reset/repair 후보가 되지 않습니다. 같은 위치에서 계속되는 정상 `가 → 각 → 간`, 의도적인 동일 음절 입력, 일반 Backspace에는 개입하지 않습니다.

상태는 마지막 active tail만 저장합니다.

```text
idle
  └─ Hangul insert → tentative
       └─ exact delete/connected insert × 2 → active pseudo-composition
            ├─ same range rewrite → active 갱신
            ├─ natural boundary → idle
            └─ select/select.pointer로 range 밖 이동 → moved guard
                 ├─ 정상 insertion → 새 입력으로 전환
                 └─ destructive delete + stale insert → atomic repair
```

## Experimental native reset 진단

Settings의 **Experimental IME reset on cursor move**는 기본 OFF인 iOS/iPadOS 전용 진단 옵션입니다. 정상 Korean pseudo-composition rewrite가 최소 두 번 확인된 뒤 selection이 active range 밖으로 이동한 경우에만 다음 순서를 실행합니다.

1. 전체 CM selection, document snapshot, editor/window scroll, visual viewport 높이를 저장합니다.
2. `EditorView.contentDOM.blur()`를 호출합니다.
3. 한 번의 `requestAnimationFrame` boundary 뒤 `contentDOM.focus({preventScroll: true})`를 호출하고, 지원하지 않으면 인자 없는 `focus()`로 fallback합니다.
4. document가 그대로인데 CM selection만 변했다면 공개 transaction으로 selection을 복원합니다. 이 transaction은 `Transaction.addToHistory.of(false)`이며 document change가 없습니다.
5. reset 뒤 첫 Korean keydown과 DOM/CM delete·insert 흐름을 기록합니다. `deleteContentBackward + stale insert`가 다시 발생하지 않은 경우에만 실기 로그를 reset 성공의 증거로 판단합니다.

코드는 focus가 돌아오고 document가 보존된 사실만 `reset-success-candidate`로 기록합니다. native IME state를 읽을 API가 없으므로 이것을 reset 성공으로 간주하지 않으며 `native-ime-reset-confirmed`는 항상 `false`입니다.

공개 API와 engine 동작을 조사한 결과는 다음과 같습니다.

- CM6의 [`EditorView.composing`/`compositionStarted`](https://codemirror.net/docs/ref/#view.EditorView.composing)는 읽기 전용 상태이며 native composition을 commit/reset하는 공개 command는 없습니다.
- CM6의 [input implementation](https://github.com/codemirror/view/blob/main/src/input.ts)은 focus/blur를 관찰해 optional focus-change effect transaction 또는 view update를 알리고 editor scroll을 복원합니다. 이 경로는 document를 바꾸지 않으며, 실험의 selection 복원은 플러그인이 공개 dispatch와 `addToHistory(false)`로 명시적으로 처리합니다.
- CM6가 즉시 blur/focus를 순환하는 코드는 [Chrome Android의 uneditable node/virtual keyboard 복구](https://github.com/codemirror/view/blob/main/src/docview.ts)에 한정됩니다. 이 선례는 focus cycling이 가능한 공개 DOM 동작임을 보여줄 뿐, iPadOS Korean IME reset 효과를 증명하지 않습니다.
- HTML focus 알고리즘의 `preventScroll`은 focus로 인한 scroll만 억제합니다. selection 또는 software keyboard 상태 보존을 보장하지 않으므로 전후 scroll/viewport를 별도로 기록합니다.
- WebKit은 contenteditable selection을 input/textarea와 다르게 보존합니다([FocusController.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/FocusController.cpp)). iOS WebKit 내부에는 blur/refocus 뒤 input context를 갱신하는 경로가 있지만 웹 콘텐츠에 native marked/pseudo state를 확인하거나 폐기하는 API는 노출되지 않습니다.
- 외장 물리키보드에서는 blur가 input context를 재생성해 stale state를 끝낼 가능성이 있지만 실기 검증이 필요합니다. software keyboard가 표시된 경우에는 keyboard dismiss/reopen, viewport resize, focus flicker 가능성이 있으므로 옵션은 기본 OFF이며 scroll과 visual viewport를 기록합니다.

`contenteditable` toggle, CM private `inputState` 수정, synthetic `compositionend`, DOM document mutation, 숨은 Space/Enter 삽입은 사용하지 않습니다.

## 선택한 atomic repair

강한 stale 증거가 실제로 나타난 경우에만 공식 [`EditorView.inputHandler`](https://codemirror.net/docs/ref/#view.EditorView^inputHandler)에서 기본 CM transaction을 검사합니다.

1. 이동 목적지에서 Hangul `keydown.key` 직후 `deleteContentBackward`가 발생합니다.
2. 기본 transaction이 `input.type`의 단일 backward deletion이고, source pseudo text가 원래 위치에 남아 있으며, range/time/selection 조건이 모두 맞으면 destructive deletion을 document와 history에 들어가기 전에 막습니다. 목적지의 정상 문자는 그대로 보존됩니다.
3. 바로 이어지는 `insertText`가 stale source와 실제 `keydown.key`의 결합임을 증명할 수 있을 때만 stale insertion 대신 의도 문자열을 한 개의 `input.type` CM transaction으로 적용합니다.
   - `휴 + 실제 key ㅇ → 흉`: Unicode 음절 구조로 final attachment가 정확히 일치하므로 의도 입력 `ㅇ`을 사용합니다.
   - 다음 결과가 `휴이`: source `휴`가 정확한 prefix이므로 검증된 suffix `이`로 앞의 임시 `ㅇ` range를 교체합니다.
4. 이때 `keyCode`를 두벌식 Jamo로 변환하지 않습니다. 브라우저가 준 실제 `keydown.key`와 `beforeinput.data`만 사용합니다.
5. stale insertion에서 완성 문자열을 증명할 수 없더라도, 같은 delete pair를 시작한 `keydown.key`가 modifier 없는 단일 Korean input임이 이미 확인됐다면 그 실제 key를 `pending-intended-key`로 보존합니다. 임의 Hangul composition은 하지 않으며, 다음 rewrite에서 검증된 suffix가 나오면 기존 intended range만 교체합니다.
6. atomic repair 뒤 selection이 다시 이동하면 이전 `intended.range`를 폐기하고 새 destination을 guard합니다.

단순 시간 경과만으로 moved guard를 해제하지 않습니다. Space/Enter/Tab/Escape/Backspace/Delete, 영어·숫자·기호, 알려진 input mode 전환 key, non-Hangul `beforeinput`, 외부 blur, 실제 composition event, range selection, undo/redo, 관련 없는 document transaction을 명시적인 종료 조건으로 사용합니다. reset 실험의 blur/focus는 성공을 가정하지 않으므로 이미 만들어진 moved guard를 첫 입력 검증까지 유지합니다.

삭제 뒤 잘못된 글자를 사후 삭제하는 방식이 아니므로 `랜더링 → 랜흉링` 같은 중간 document state가 CM history에 들어가지 않습니다. 정상 문자는 유지되고, 검증된 의도 입력만 일반 `input.type` history step으로 남습니다. selection은 그 transaction의 새 입력 끝으로 명시됩니다.

## Debug logging

Debug OFF에서는 snippet 생성이나 JSON 직렬화를 하지 않습니다. ON일 때도 최대 500개 event와 cursor 주변 반경 24 code unit만 메모리에 보관하며 전체 note, title, vault path는 저장하지 않습니다.

각 DOM event/CM transaction의 `details`에는 다음 상태가 추가됩니다.

- `pseudoComposition.active`
- `pseudoComposition.lastRange`
- `pseudoComposition.lastText`
- `pseudoComposition.lastRewriteTime`
- `pseudoComposition.rewriteCount`
- `selectionMovedOutsidePseudoRange`

판정 과정은 `reset-attempt`, `stale-rewrite-detected`, `stale-rewrite-suppressed`, `atomic-repair`로 확인할 수 있습니다. 실험 옵션 ON에서는 `ime-reset-attempt`, `ime-reset-blur`, `ime-reset-focus`, `ime-reset-first-input-trace`가 selection/scroll 전후, reset latency, success candidate, 첫 Korean 입력의 delete/insert 및 repair 판정을 기록합니다.

## 안전 범위와 남은 위험

이 구현은 iOS/iPadOS에서만 자동 활성화되고, 다음 경우에는 문서를 임의로 고치지 않습니다.

- `keydown.key`가 Hangul 실제 입력을 제공하지 않음
- source text가 이동 전 range에서 사라짐
- rewrite가 single change가 아니거나 `input.type`이 아님
- selection, range, Hangul 연결성 또는 explicit session evidence가 맞지 않음

남은 위험은 다음과 같습니다.

- 실제 iPad에서 input handler가 destructive deletion과 insertion 사이에 DOM selection을 어떤 순서로 resync하는지는 확인이 필요합니다.
- unprovable stale 변형은 브라우저가 반환한 합성 결과 대신 검증된 실제 Korean key 하나만 보존하므로 순간적으로 Jamo가 보일 수 있습니다.
- 80ms/160ms의 delete/insert association 제한 밖의 매우 느린 event delivery는 놓칠 수 있습니다.
- 명시적인 boundary 없이 오래 유지된 confirmed session은 시간만으로 만료하지 않습니다. 오판 시에도 기존 문서를 삭제하지 않는 조건을 우선합니다.
- experimental blur/focus는 software keyboard를 닫거나 다시 띄우고 viewport/scroll/focus를 흔들 수 있습니다.
- 복합 Jamo, 세벌식, 특수 입력 source처럼 실제 key/data가 다른 경로는 안전을 위해 repair하지 않을 수 있습니다.
- Obsidian에 내장된 CM 버전별 DOM diff range 차이는 실제 앱에서 검증해야 합니다.

이 제한은 정상 한글·영어·다른 IME·desktop에 대한 오판보다 문서 보존을 우선한 결과입니다.

## 설치

### BRAT

1. Obsidian Community plugins에서 **BRAT**을 설치하고 활성화합니다.
2. **Add a beta plugin for testing**을 실행합니다.
3. 다음 repository URL을 입력하고 latest version을 선택합니다.

```text
https://github.com/braininavat06/obsidian-korean-render
```

4. Community plugins에서 **Korean Render**를 활성화합니다.

Release에는 BRAT용 `main.js`와 `manifest.json`이 첨부됩니다. CSS를 사용하지 않으므로 `styles.css`는 없습니다.

### 수동 설치

Release asset을 받거나 checkout에서 `npm run build`를 실행한 뒤 다음 폴더를 vault에 복사합니다.

```text
dist/korean-render/          → <Vault>/.obsidian/plugins/korean-render/
  main.js
  manifest.json
```

Settings에는 **Enable Korean Render**(기본 ON), **Debug logging**(기본 OFF), **Experimental IME reset on cursor move**(기본 OFF)가 있습니다. 실험 reset은 iOS/iPadOS에서만 실행됩니다.
Debug logging을 OFF에서 ON으로 켜면 이전 session의 in-memory log를 먼저 비웁니다.
Command Palette의 **Korean Render: Clear debug log**는 ring buffer만 즉시 비우며 document와 pseudo-composition state는 변경하지 않습니다. **Copy debug log**는 복사 뒤 log를 자동 삭제하지 않습니다.

## 실제 iPadOS 검증 절차

중요한 note가 아닌 새 test vault/note에서 먼저 실행하십시오. experimental reset이 native IME에서 확인되기 전에는 원본 note의 backup을 권장합니다.

1. iPadOS 기본 Korean IME와 문제를 재현한 Bluetooth keyboard를 연결합니다.
2. Obsidian Mobile을 Live Preview로 두고 Korean Render ON, Debug logging ON으로 설정합니다.
3. `가 → 각 → 간 → 갇`처럼 한 위치에서 조합을 계속하고 모든 글자가 정상인지 확인합니다.
4. 한글 입력 뒤 같은 위치에서 계속 문장을 입력해 개입이 없는지 확인합니다.
5. 마지막 음절을 입력한 직후 ArrowLeft/Right/Up/Down 각각으로 active tail 밖에 이동하고 바로 한글을 입력합니다.
6. 같은 절차를 화면 touch로 다른 위치를 선택해 반복합니다.
7. 제공한 trace를 그대로 재현합니다: 마지막 syllable을 `휴`로 만든 뒤 이동하고 `ㅇ`, `ㅣ`를 빠르게 입력합니다. 원래 목적지 문자가 사라지지 않고 `흉`/`휴이`가 남지 않는지 확인합니다.
8. 같은 위치와 이동 후 위치에서 정상 Backspace를 반복합니다.
9. 영어, 숫자, 기호를 각각 입력합니다.
10. 한영 전환 직후 양쪽 언어를 입력합니다.
11. Space와 Enter 직후 새 입력을 시작합니다.
12. 방향키를 빠르게 여러 번 연타한 뒤 입력합니다.
13. 한 글자 이상 range를 선택한 뒤 한글/영어를 입력합니다.
14. 각 경우 뒤 Undo/Redo를 반복해 정상 원문, 새 입력, selection 순서에 이상한 중간 상태가 없는지 확인합니다.
15. 다른 위치에서 의도적으로 앞과 동일한 음절을 다시 입력합니다.
16. 긴 note에서 wikilink, callout, image/embed 앞뒤와 viewport 밖에서 같은 절차를 반복하고 scroll/focus가 튀지 않는지 확인합니다.
17. 성공 직후 **Korean Render: Copy debug log**를 실행해 `reset-attempt` 뒤 정상 insertion 또는 `stale-rewrite-detected → stale-rewrite-suppressed → atomic-repair` 순서가 있는지 확인합니다.
18. 실패했다면 문서의 실제 결과, Obsidian/iPadOS version, iPad/keyboard model, 입력 source, 방향키/터치 여부와 함께 JSON Lines 전체를 전달하십시오.

### Experimental reset A/B

중요하지 않은 동일한 test note와 동일한 외장 키보드를 사용합니다.

1. **Experimental IME reset on cursor move**를 OFF로 둡니다.
2. Debug logging을 켜고 **Korean Render: Clear debug log**를 실행합니다.
3. 기준 문장을 입력하고, 동일한 방향키/터치 이동과 동일한 Korean key 순서로 기존 문제를 재현합니다.
4. debug log와 실제 document 결과를 보관합니다.
5. 실험 옵션을 ON으로 바꾸고 **Korean Render: Clear debug log**를 다시 실행합니다.
6. 같은 문장, 같은 cursor 이동, 같은 key 순서를 반복합니다.
7. `ime-reset-attempt → ime-reset-blur → ime-reset-focus` 뒤 첫 `ime-reset-first-input-trace`를 비교합니다.
8. 첫 Korean 입력에서 `deleteContentBackward`와 stale rewrite가 다시 나타났는지, selection/scroll/visual viewport가 변했는지, software keyboard가 깜박이거나 닫혔는지 기록합니다.
9. `reset-success-candidate: true`만으로 성공 판정하지 않습니다. OFF에서는 발생했던 stale delete/rewrite가 ON의 동일 입력에서 사라졌을 때만 native reset 성공 후보로 해석합니다.

민감한 문장이 cursor 가까이에 있다면 log를 보내기 전에 snippet을 지우십시오.

## 개발 및 검증

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

자동 테스트는 다음 불변조건을 고정합니다.

- 기존 document text는 stale repair/reset 때문에 사라지지 않는다.
- modifier 없는 유효한 단일 Korean physical key는 조용히 버려지지 않는다.
- 차단 및 reset selection 복원은 history에 숨은 document state를 만들지 않는다.
- reset 전 CM cursor/selection을 유지하고, 필요할 때만 history 없는 공식 dispatch로 복원한다.
- 증거가 부족하면 기존 document와 실제 key를 보존하고 진단 정보를 남긴다.

- 실제 composition path: [`src/ime-state-machine.ts`](src/ime-state-machine.ts)
- composition-less path: [`src/pseudo-composition-state-machine.ts`](src/pseudo-composition-state-machine.ts)
- CM integration/diagnostic: [`src/editor-extension.ts`](src/editor-extension.ts)
- unit tests: [`tests`](tests)
