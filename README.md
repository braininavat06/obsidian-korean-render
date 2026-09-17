# Korean Render

Obsidian Mobile의 기본 Live Preview를 그대로 유지하면서, iOS/iPadOS Korean IME가 커서 이동 뒤 이전 한글 조합 상태를 새 위치에 재사용해 문서를 손상시키는 경로를 매우 보수적으로 막는 플러그인입니다.

- 별도 editor, `textarea`, `input`, hotkey가 없습니다.
- Live Preview, wikilink, callout, embed, 다른 CodeMirror extension을 바꾸지 않습니다.
- workaround는 Obsidian iOS/iPadOS 앱에서만 활성화됩니다. Debug logging은 원인 확인을 위해 다른 플랫폼에서도 켤 수 있습니다.
- 정상 composition event가 오는 환경의 v0.1.0 경로를 그대로 유지합니다.
- `@codemirror/*`를 bundle하지 않고 Obsidian이 제공하는 인스턴스를 사용합니다.

> v0.1.3 A/B 실기 로그에서 `blur → requestAnimationFrame → focus({preventScroll:true})`는 native stale IME state를 종료하지 못했습니다. reset 직후 첫 Korean 입력에서도 destructive delete와 stale rewrite가 동일하게 발생했고, 실기에서 cursor가 튀는 부작용도 관찰되어 해당 실험 설정과 focus cycle은 v0.1.4에서 제거했습니다.

## v0.1.10

v0.1.10은 v0.1.9 실제 iPad trace에서 확인된 pseudo-composition confidence lifecycle regression을 수정한 실기 검증 릴리스입니다.

- 이미 증명된 Korean pseudo-composition tail이 exact delete된 뒤 같은 range에 즉시 native Hangul replacement가 적용되면, 같은 lineage의 confidence를 보존합니다. 따라서 `고 → 과`처럼 native rewrite가 이어진 뒤에도 cursor-move protection이 유지됩니다.
- Control, Meta, Alt, Shift 단독 keydown과 아직 효과가 확인되지 않은 modifier shortcut은 valid Korean IME tracking state를 종료하지 않습니다. 실제 selection/document transaction, undo/redo, paste/drop 같은 후속 증거가 lifecycle boundary를 결정합니다.
- modifier-only input 뒤 cursor move 및 `고 → 과 → ArrowLeft → 괍/괗` real-device regression coverage를 추가했습니다.

## v0.1.8

v0.1.8은 실제 iPad/BRAT 실기 검증을 위한 lifecycle 수정 릴리스입니다.

- moved repair 도중 새 Korean pseudo-composition이 시작될 때 새 lineage로 넘기는 handoff를 수정했습니다.
- repaired Jamo의 exact delete/native replacement가 확인되면 `single-confirmed-lineage`를 다음 cursor move까지 보존합니다.
- 플러그인이 Korean Backspace rewind 뒤 native state를 너무 일찍 종료하던 regression을 수정했습니다.
- stale native continuation이 moved destination의 기존 document text를 삭제하지 못하도록 보호합니다.
- v0.1.7 lifecycle trace를 축약한 handoff, `셈/세므`, Backspace rewind regression coverage를 추가했습니다.

## v0.1.9

v0.1.9는 v0.1.8 실제 iPad/BRAT trace에서 확인된 세 가지 lifecycle regression을 수정한 실기 검증 릴리스입니다.

- cursor 이동 뒤 native delete 없이 stale Hangul이 직접 insert되는 경우, 실제 Korean key와 기존 native tail의 연결이 증명되면 stale text 대신 신규 입력만 repair합니다.
- iPadOS의 duplicate non-repeat Backspace keydown 및 실제 `delete.backward` transaction을 지나도 Backspace rewind lifecycle을 유지합니다. 현재 음절의 정상 rewind는 허용하면서 document-owned text 침범과 뒤따르는 stale insertion은 차단합니다.
- moved repair가 intended tail, native tail 및 실제 document tail의 exact delete를 통해 재동기화됐음을 확인하면, `호 → 화` 같은 정상 native continuation을 raw Jamo로 분해하지 않고 관측된 native result를 사용합니다.
- direct stale insert, Backspace rewind/spill, `호 → 화`, 전체 `화려강산` native continuation의 실제 trace 기반 regression coverage를 추가했습니다.

## v0.1.4

v0.1.4는 v0.1.3의 실제 iPadOS + Bluetooth keyboard A/B trace를 ground truth로 삼아 repair 경로를 보수적으로 수정한 릴리스입니다.

- `Experimental IME reset on cursor move` 설정과 UI를 완전히 제거했습니다.
- 효과가 없고 cursor jump가 관찰된 `blur → requestAnimationFrame → focus({preventScroll:true})` reset 코드를 제거했습니다.
- `pending-intended-key`가 기존 intended range를 raw Jamo로 덮어쓰던 regression을 수정했습니다.
- iPadOS가 제공하는 native Korean rewrite continuation을 검증한 뒤 사용할 수 있도록 했습니다.
- 이동 목적지의 intended text/range를 누적 추적하고, selection이 다시 이동하면 이전 intended range를 폐기합니다.
- moved guard의 source/destination/intended diagnostics를 강화했습니다.
- 실제 A/B trace를 익명화한 fixture와 replay regression test를 추가했습니다.

v0.1.3 실기 로그에서 확인한 핵심 결과는 다음과 같습니다.

- A/OFF와 B/ON 모두 cursor 이동 뒤 첫 key에서 `deleteContentBackward → stale Hangul insert`가 발생했습니다.
- B의 네 번의 focus cycle은 CM selection/document/scroll을 로그상 보존했지만 native stale state는 보존된 채였고, 실기에서는 cursor jump가 관찰됐습니다.
- 따라서 experimental reset 설정과 모든 plugin-initiated blur/focus 코드는 v0.1.4에서 제거했습니다.
- A/B 모두 세 번째 post-move key부터 `pending-intended-key`가 기존 intended range를 raw Jamo로 덮어쓰는 regression을 보였습니다.
- 현재 repair는 stale prefix를 제거할 수 있는 첫 단계 뒤, iPadOS가 준 `beforeinput.data`가 현재 목적지 음절의 연결된 rewrite임을 증명할 수 있을 때 그 native text를 사용합니다. 임의 Hangul composer나 keyboard-layout 변환은 사용하지 않습니다.
- 증명할 수 없는 실제 Korean key는 기존 intended text를 덮어쓰지 않고 현재 cursor에 보존합니다.

## v0.1.5

v0.1.5는 v0.1.4 실기 trace에서 확인된 두 regression을 최소 침습적으로 수정합니다. Document 보호 source와 native IME의 현재 rewrite tail이 서로 달라질 수 있으므로 다음 세 상태를 독립적으로 추적합니다.

- `protectedSourceRange/Text`: cursor 이동 전 원래 pseudo-composition source. 기존 document가 유지되는지 검증하는 용도로만 사용합니다.
- `nativeTailRange/Text`: WebKit이 실제 delete/insert rewrite에 사용한 현재 tail. 실제 native data로만 갱신합니다.
- `intendedRange/Text`: 새 위치에서 atomic repair로 복구 중인 사용자 입력입니다.

따라서 첫 repair 뒤 native tail이 `라`에서 `나`로 바뀐 실제 `나 → 낙 → 나가 → 간 → 가나` 흐름도 원래 protected source를 변경하지 않고 따라갑니다. Native result가 동일 repair lineage의 pending Jamo 전체를 합성했음이 Unicode 분해로 정확히 검증되는 좁은 경우에는 마지막 code point가 아니라 pending intended range 전체를 교체합니다. 플러그인이 임의의 Hangul 결과를 생성하지는 않습니다.

또한 물리 Backspace/Delete로 non-empty selection의 `delete.selection`이 완료된 직후, Korean keydown 없이 같은 위치에 Hangul `insertText`가 재생되는 v0.1.4 trace를 위한 one-shot guard가 추가됐습니다. 실제 replay는 삭제 완료 약 10ms 뒤 발생했으므로 guard window는 40ms로 제한했습니다. 이는 관찰값의 네 배이면서 검토 범위 40–80ms 중 가장 작은 값입니다. 새 Korean keydown, Space/Enter, printable non-Korean key, selection 변화, composition, paste/drop, undo/redo, 외부 blur, 다른 document transaction 또는 timeout에서 즉시 해제됩니다.

## v0.1.7

v0.1.7은 v0.1.6 실제 iPad trace에서 확인된 single-rewrite lineage를 제한적으로 보호하는 릴리스입니다.

- 전역 `PSEUDO_MIN_REWRITES = 2`는 유지합니다.
- 다만 실제 Korean keydown에 연결된 단일 호환 자모 삽입, 정확히 같은 범위·텍스트의 delete, 같은 native burst의 단일 완성 음절 replacement가 모두 확인된 경우에만 `single-confirmed-lineage` confidence로 moved guard를 arm합니다.
- 단순 자모/완성 음절 입력, 다른 범위 삭제·삽입, unrelated Hangul, selection 중단, paste/composition/undo/redo 및 association window 밖의 입력은 이 예외를 얻지 못합니다.
- 기존 protected source / native tail / intended state 분리, shifted-native-tail protection, post-delete stale replay suppression은 변경하지 않았습니다. Debug log 복제 관련 코드는 변경하지 않았습니다.

## v0.1.6

v0.1.6은 v0.1.5 실제 iPad trace에서 확인된 두 regression만 제한적으로 수정한 릴리스입니다.

- Active moved-repair 도중 WebKit이 예상 `nativeTailRange`가 아니라 `intendedRange`의 active edge 바로 다음 range에서 동일 native tail을 지우려 한 trace를 별도 `shifted-native-tail` anomaly로 처리합니다. 이미 활성인 lineage, 동일 keydown selection, 정확한 active edge 인접성, native tail의 range/길이/text 일치, 단일 `input.type` deletion이 모두 증명될 때만 destructive delete를 사전에 막습니다. 보호 source와 intended range는 바꾸지 않고, 관측된 native tail range만 기록한 뒤 기존 continuation 판정을 이어갑니다.
- Selection 삭제 뒤 같은 `deleteContentBackward` burst에서 발생한 `docChanged=false`, `changeCount=0`, selection 불변 no-op input은 replay guard를 해제하지 않습니다. 실제 multi-change/document-changing transaction이나 selection 변화는 계속 즉시 해제합니다.
- 40ms는 stale 판정의 주 증거가 아니라 이미 엄격한 event-order 조건으로 arm된 one-shot guard의 보조 lifetime 제한입니다. 이번 수정에서 window를 늘리거나 Hangul 판정을 일반화하지 않았습니다.

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

처음 Hangul insertion 한 번이나 rewrite 한 번만으로는 repair 후보가 되지 않습니다. 같은 위치에서 계속되는 정상 `가 → 각 → 간`, 의도적인 동일 음절 입력, 일반 Backspace에는 개입하지 않습니다.

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

## Experimental reset A/B 결론

B/ON trace의 focus cycle 네 번은 각각 4–15ms에 완료됐고 `selection-before == selection-after`, `document-unchanged: true`, 동일 scroll/viewport를 기록했습니다. 그러나 마지막 focus 뒤 첫 Korean key까지 249ms 및 410ms가 지난 뒤에도 `deleteContentBackward`와 stale `락`이 발생했습니다. 이후 모든 key에서도 같은 stale rewrite가 이어졌습니다.

따라서 focus 복귀를 뜻하는 과거의 `reset-success-candidate`는 native reset 성공과 무관했습니다. v0.1.4는 이 실험을 production 후보로 발전시키지 않으며 `contentDOM.blur()/focus()`를 호출하지 않습니다. CM6/WebKit에는 이 pseudo state를 읽거나 종료하는 공개 API가 확인되지 않았으므로 결과 repair만 강한 trace 증거 아래 수행합니다.

## 선택한 atomic repair

강한 stale 증거가 실제로 나타난 경우에만 공식 [`EditorView.inputHandler`](https://codemirror.net/docs/ref/#view.EditorView^inputHandler)에서 기본 CM transaction을 검사합니다.

1. 이동 목적지에서 Hangul `keydown.key` 직후 `deleteContentBackward`가 발생합니다.
2. 기본 transaction이 `input.type`의 단일 backward deletion이고, source pseudo text가 원래 위치에 남아 있으며, range/time/selection 조건이 모두 맞으면 destructive deletion을 document와 history에 들어가기 전에 막습니다. 목적지의 정상 문자는 그대로 보존됩니다.
3. 바로 이어지는 `insertText`가 stale source와 실제 `keydown.key`의 결합임을 증명할 수 있을 때 stale prefix를 제거한 의도 문자열을 한 개의 `input.type` CM transaction으로 적용합니다.
   - `휴 + 실제 key ㅇ → 흉`: Unicode 음절 구조로 final attachment가 정확히 일치하므로 의도 입력 `ㅇ`을 사용합니다.
   - 다음 결과가 `휴이`: source `휴`가 정확한 prefix이므로 검증된 suffix `이`로 앞의 임시 `ㅇ` range를 교체합니다.
4. 이때 `keyCode`를 두벌식 Jamo로 변환하지 않습니다. 브라우저가 준 실제 `keydown.key`와 `beforeinput.data`만 사용합니다.
5. stale prefix가 더 이상 나타나지 않는 후속 단계에서는, `beforeinput.data`가 방금 목적지에서 삭제하려 한 intended tail의 연결된 Hangul rewrite인지 검증합니다. 예를 들어 `가 → 간 → 가나`, `나 → 낟 → 나다`가 실제 native data와 일치할 때만 해당 tail을 교체합니다.
6. 완성 문자열을 증명할 수 없더라도 modifier 없는 단일 Korean `keydown.key`는 버리지 않습니다. 다만 기존 intended range를 raw Jamo로 덮어쓰지 않고 cursor에 추가해 기존 문서를 보존합니다.
7. atomic repair 뒤 selection이 다시 이동하면 이전 `intended.range`를 폐기하고 새 destination을 guard합니다.

단순 시간 경과만으로 moved guard를 해제하지 않습니다. Space/Enter/Tab/Escape/Backspace/Delete, 영어·숫자·기호, 알려진 input mode 전환 key, non-Hangul `beforeinput`, 외부 blur, 실제 composition event, range selection, undo/redo, 관련 없는 document transaction을 명시적인 종료 조건으로 사용합니다.

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
- `movedGuard.protectedSourceRange/protectedSourceText`
- `movedGuard.nativeTailRange/nativeTailText`
- `movedGuard.destination/intendedRange/intendedText`
- `pendingPostDeleteReplayGuard`

판정 과정은 `pseudo-moved-guard-armed`, `shifted-native-tail-delete-detected`, `stale-rewrite-detected`, `stale-rewrite-suppressed`, `atomic-repair`로 확인할 수 있습니다. 일반 moved guard의 최소 기준은 계속 2회 rewrite입니다. 단, 실제 Korean keydown에 연결된 단일 호환 자모 삽입 뒤 같은 범위·같은 텍스트의 native delete와 같은 burst의 단일 완성 음절 replacement가 모두 관측된 경우에만 `single-rewrite-lineage-confirmed`로 기록하고 예외적으로 guard를 허용합니다. `pseudo-moved-guard-armed.details.guardConfidence`는 이 좁은 경로를 `single-confirmed-lineage`, 기존 경로를 `multi-rewrite`로 구분하며, 전자의 snapshot에는 initial/deleted/replacement text·range와 관측 간격만 기록됩니다. `atomic-repair.details.intendedTextSource`는 stale prefix 제거면 `derived`, 검증된 native continuation이면 `native-rewrite`, 증명 불가 key 보존이면 `pending-intended-key`입니다. 해당 두 source는 별도 `native-rewrite`, `pending-intended-key` event로도 남습니다. Selection delete replay guard는 `post-delete-replay-guard-armed`, `post-delete-noop-preserved`, `post-delete-guard-disarmed`의 정확한 reason과 `stale-replay-suppressed`로 확인할 수 있습니다.

## 안전 범위와 남은 위험

이 구현은 iOS/iPadOS에서만 자동 활성화되고, 다음 경우에는 문서를 임의로 고치지 않습니다.

- `keydown.key`가 Hangul 실제 입력을 제공하지 않음
- source text가 이동 전 range에서 사라짐
- rewrite가 single change가 아니거나 `input.type`이 아님
- selection, range, Hangul 연결성 또는 explicit session evidence가 맞지 않음

남은 위험은 다음과 같습니다.

- 실제 iPad에서 input handler가 destructive deletion과 insertion 사이에 DOM selection을 어떤 순서로 resync하는지는 확인이 필요합니다.
- unprovable stale 변형은 기존 intended text 뒤에 실제 Korean key 하나를 보존하므로 순간적으로 Jamo가 보일 수 있습니다. 기존 intended text나 목적지 문자를 추측해 덮어쓰지는 않습니다.
- 80ms/160ms의 delete/insert association 제한 밖의 매우 느린 event delivery는 놓칠 수 있습니다.
- 명시적인 boundary 없이 오래 유지된 confirmed session은 시간만으로 만료하지 않습니다. 오판 시에도 기존 문서를 삭제하지 않는 조건을 우선합니다.
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

Settings에는 **Enable Korean Render**(기본 ON), **Debug logging**(기본 OFF)가 있습니다.
Debug logging을 OFF에서 ON으로 켜면 이전 session의 in-memory log를 먼저 비웁니다.
Command Palette의 **Korean Render: Clear debug log**는 ring buffer만 즉시 비우며 document와 pseudo-composition state는 변경하지 않습니다. **Copy debug log**는 복사 뒤 log를 자동 삭제하지 않습니다.

## 실제 iPadOS 검증 절차

중요한 note가 아닌 새 test vault/note에서 먼저 실행하고 원본 note는 backup한 뒤 검증하십시오.

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
17. 성공 직후 **Korean Render: Copy debug log**를 실행해 `pseudo-moved-guard-armed` 뒤 정상 insertion 또는 `stale-rewrite-detected → stale-rewrite-suppressed → atomic-repair` 순서가 있는지 확인합니다.
18. 실패했다면 문서의 실제 결과, Obsidian/iPadOS version, iPad/keyboard model, 입력 source, 방향키/터치 여부와 함께 JSON Lines 전체를 전달하십시오.

### A/B trace 기반 회귀 시나리오

중요하지 않은 test note와 동일한 외장 키보드를 사용합니다.

1. `가나다라`를 입력하고 마지막 `라`가 active tail인 상태에서 ArrowLeft를 두 번 눌러 `나|다`로 이동합니다.
2. `ㄱ, ㅏ, ㄴ, ㅏ, ㄷ, ㅏ, ㄹ, ㅏ` 순서로 입력합니다.
3. 목적지 앞의 `나`와 원래 source의 `라`가 보존되고, 새 입력이 raw Jamo로 교대로 덮어써지지 않으며 `가나다라`로 조합되는지 확인합니다.
4. 같은 시나리오를 빠른 방향키 연타와 touch selection으로 각각 반복합니다.
5. 각 key 뒤 Undo/Redo를 실행해 삭제된 목적지 문자나 stale 문자열이 중간 history state로 나타나지 않는지 확인합니다.
6. Space/Enter, 영어/숫자/기호, 한영 전환 뒤에는 moved guard가 종료되고 정상 입력에 개입하지 않는지 확인합니다.

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

- 기존 document text는 stale repair 때문에 사라지지 않는다.
- modifier 없는 유효한 단일 Korean physical key는 조용히 버려지지 않는다.
- 차단 및 atomic repair는 history에 destructive intermediate document state를 만들지 않는다.
- cursor/selection은 사용자가 이동한 destination과 검증된 새 입력 끝을 따른다.
- 증거가 부족하면 기존 document와 실제 key를 보존하고 진단 정보를 남긴다.

- 실제 composition path: [`src/ime-state-machine.ts`](src/ime-state-machine.ts)
- composition-less path: [`src/pseudo-composition-state-machine.ts`](src/pseudo-composition-state-machine.ts)
- CM integration/diagnostic: [`src/editor-extension.ts`](src/editor-extension.ts)
- unit tests: [`tests`](tests)
