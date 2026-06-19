# Git QuickPick

VS Code 사이드바에서 모든 Git 작업을 수행하는 확장.

> [English](README_en.md)

## 활용 워크플로우

Git QuickPick을 사용한 일반적인 개발 흐름:

```
1. 브랜치 생성       main(또는 develop)에서 버그/기능 브랜치 생성
       ↓                "브랜치 생성" 으로 새 브랜치 만들기
2. 개발              개발 중 자유롭게 커밋
       ↓
3. 개발 완료         해당 브랜치에서 개발 완료
       ↓
4. 커밋 합치기       "여기서부터 커밋 합치기" 로 아무렇게나 한 커밋들을
       ↓                하나의 깔끔한 커밋으로 합치기
5. Rebase onto      "현재 브랜치를 여기 위에 Rebase (onto)" 로
       ↓                main(또는 develop)의 변경사항을 현재 브랜치 아래로 재배치
6. 최종 테스트       리베이스 후 최종 테스트 수행
       ↓
7. Merge into       main(또는 develop)으로 전환 후
                        "현재 브랜치에 Merge (into)" 로 작업 브랜치 병합

  ── 필요 시 ──────────────────────────────────────────────

8. Cherry Pick       수정 커밋을 다른 버전 브랜치에도 반영
                        예) main에 머지한 버그픽스를 2.1.x 브랜치에도 적용,
                            필요하면 2.0.x 등 이전 버전 브랜치에도 "체리픽"
```

---

## 사이드바 구조

```
GIT QUICKPICK
  히스토리 · 브랜치 (WebView)        [⟳][＋][↑][⇪][↓][⤓][⤵][🧹][⚙]
    커밋 메시지 입력 (Ctrl+Enter로 커밋)  [✓ 커밋]   ← 위치: top/bottom/hidden 설정
    v History
        버그 수정            2026-04-07 PM 08:45  홍길동      a1b2c3d
        사용자 목록 추가     2026-04-06 AM 10:30  홍길동      e4f5g6h
    > Local Branches
        v main (현재)
            (그 브랜치 커밋 테이블)
        feature/login
    > Remote Branches
        origin/main
        ☁⤓ origin/develop (미페치)

  작업 공간 (트리)
    v Changes          main . 2개 변경
        [v] web.xml     M    [변경 되돌리기] [파일 삭제]
        [v] App.java    M    [변경 되돌리기] [파일 삭제]
    > Stashes
```

> **히스토리·브랜치는 WebView로 렌더**되어 커밋 필드별 밝기(bright/dim)와 고정폭 정렬이
> 가능합니다(요구 1). 커밋 메시지 입력창은 같은 WebView 안에 통합되며 위치를
> `messageInputPosition`(top/bottom/hidden)으로 조절합니다(요구 2). 변경 파일·스태시는
> 체크박스·멀티셀렉트·파일 아이콘이 우월한 네이티브 트리를 유지합니다(하이브리드).
> 커밋/브랜치 우클릭 메뉴·상단 툴바·키보드(↑/↓ 이동, Enter, ←/→ 접기·펼치기)로 조작합니다.

---

## 기능 상세

### 1. 여기서부터 커밋 합치기 (Squash)

여러 커밋을 하나로 합쳐서 히스토리를 깔끔하게 정리합니다.

```
사용 전                              사용 후

  o  fix: 오타 수정     (HEAD)        o  로그인 기능 구현    (HEAD)
  o  fix: 버그 수정                   o  이전 커밋
  o  feat: 로그인 구현                o  ...
  o  이전 커밋
  o  ...

  History에서 "feat: 로그인 구현" 우클릭
  → "여기서부터 커밋 합치기"
  → 3개 커밋이 1개로 합쳐짐
```

**사용 방법:**
1. History에서 합치기 시작할 커밋을 우클릭
2. **"여기서부터 커밋 합치기"** 선택
3. 사이드바 메시지 입력창에 기존 커밋 메시지들이 자동 입력됨 (멀티라인 편집 가능)
4. 버튼이 **"커밋 합치기"**로 변경됨 — 클릭 또는 Ctrl+Enter로 실행
5. 커밋 시간 선택: "원래 커밋 시간 유지" 또는 "현재 시간 사용"

---

### 2. 커밋 메시지 수정 (Amend)

최신 커밋의 메시지를 수정합니다.

```
사용 전                              사용 후

  o  fix: 오탈 수정     (HEAD)        o  fix: 오타 수정      (HEAD)
  o  이전 커밋                        o  이전 커밋
  o  ...                              o  ...
```

**사용 방법:**
1. History에서 **가장 위(최신) 커밋**을 우클릭
2. **"커밋 메시지 수정"** 선택
3. 사이드바 메시지 입력창에 현재 메시지가 표시됨 — 수정 후 **"메시지 수정"** 버튼 클릭
4. 커밋 시간 선택: "원래 커밋 시간 유지" 또는 "현재 시간 사용"

> 최신 커밋이 아닌 경우 이 메뉴는 표시되지 않습니다.

---

### 3. 현재 브랜치를 여기 위에 Rebase (onto)

현재 브랜치의 커밋들을 대상 브랜치 위로 재배치합니다. 히스토리가 깔끔해지지만 커밋 해시가 변경됩니다.

```
사용 전                              사용 후

  o  C3  (feature)                    o  C3' (feature, HEAD)
  o  C2                               o  C2'
  |                                   |
  | o  B2  (main)                   o  B2  (main)
  | o  B1                             o  B1
  |/                                  |
  o  A1                               o  A1

  Local Branches에서 "main" 우클릭
  → "현재 브랜치를 여기 위에 Rebase (onto)"
  → feature 브랜치가 main 위로 재배치됨
```

**사용 방법:**
1. Local/Remote Branches에서 대상 브랜치를 우클릭
2. **"현재 브랜치를 여기 위에 Rebase (onto)"** 선택
3. 확인 다이얼로그에서 동작 설명 확인 후 진행
4. 충돌 시 3-way merge editor에서 해결 → Continue 버튼 클릭

---

### 4. 현재 브랜치에 Merge (into)

대상 브랜치의 변경사항을 현재 브랜치에 합칩니다. 머지 커밋이 생성되며 양쪽 히스토리가 보존됩니다.

```
사용 전                              사용 후

  o  C3  (feature, HEAD)              o  M   (feature, HEAD) ← 머지 커밋
  o  C2                               |\
  |                                   | o  B2  (main)
  | o  B2  (main)                   | o  B1
  | o  B1                             o  C3
  |/                                  o  C2
  o  A1                               |/
                                      o  A1

  Local Branches에서 "main" 우클릭
  → "현재 브랜치에 Merge (into)"
  → main의 변경사항이 feature에 합쳐짐
```

**사용 방법:**
1. Local/Remote Branches에서 합칠 브랜치를 우클릭
2. **"현재 브랜치에 Merge (into)"** 선택
3. 확인 다이얼로그에서 동작 설명 확인 후 진행
4. 충돌 시 3-way merge editor에서 해결 → Continue 버튼 클릭

---

### 5. 충돌 해결 Flow

Rebase/Merge/Cherry-pick 중 충돌이 발생하면:

```
충돌 발생
  │
  ├─ 알림: "에디터에서 해결" / "취소" / "터미널 열기"
  │
  ├─ "에디터에서 해결" 선택
  │     → 3-way Merge Editor 열림 (Current | Incoming | Result)
  │     → Result 영역에서 충돌 해결
  │
  ├─ 사이드바에 버튼 표시:
  │     [▶ Continue Rebase]  ← 충돌 해결 후 클릭
  │     [✕ Abort Rebase]     ← 작업 취소
  │
  └─ Continue 클릭
        → git add . + git rebase --continue
        → 추가 충돌 있으면 반복
        → 완료
```

---

### 6. 체리픽 (Cherry Pick)

다른 브랜치의 특정 커밋을 현재 브랜치에 적용합니다.

```
사용 전                              사용 후

  o  C2  (feature, HEAD)              o  B2' (feature, HEAD) ← 체리픽
  o  C1                               o  C2
  |                                   o  C1
  | o  B2  (main) ← 이 커밋만!     |
  | o  B1                             | o  B2  (main)
  |/                                  | o  B1
  o  A1                               |/
                                      o  A1
```

**사용 방법:**
1. Local/Remote Branches에서 브랜치를 펼침
2. 커밋 목록에서 원하는 커밋을 우클릭
3. **"체리픽"** 선택

---

### 7. 브랜치 관리

| 기능 | 방법 |
|---|---|
| **브랜치 생성** | Local Branches 섹션 우클릭 → "브랜치 생성" |
| **브랜치 전환** | 브랜치 우클릭 → "브랜치 전환" |
| **원격에서 풀** | 브랜치 우클릭 → "원격에서 풀" |
| **원격에서 강제 풀** | 브랜치 우클릭 → "원격에서 강제 풀" (확인 2회) |
| **원격 브랜치 체크아웃** | Remote Branches에서 우클릭 → "브랜치 전환" (로컬 트래킹 자동 생성) |

---

### 8. 커밋 & 변경 사항

| 기능 | 방법 |
|---|---|
| **체크된 파일 커밋** | 파일 체크 → 메시지 입력 → Commit 버튼 또는 Ctrl+Enter |
| **파일 Diff 보기** | Changes/History 파일 **더블클릭** |
| **변경 되돌리기** | 파일 hover → ↩ 버튼 (마지막 커밋 시점으로 되돌림) |
| **파일 삭제** | 파일 hover → 🗑 버튼 |
| **커밋 메시지 수정** | History 최신 커밋 우클릭 → "커밋 메시지 수정" |
| **여기서부터 커밋 합치기** | History 커밋 우클릭 → "여기서부터 커밋 합치기" |
| **소프트 리셋** | History 커밋 우클릭 → "소프트 리셋" |
| **하드 리셋** | History 커밋 우클릭 → "하드 리셋" |
| **푸시** | 타이틀 바 ☁ 버튼 — 원격에 로컬에 없는 커밋이 있으면 "rebase(onto) 후 push" 선택 모달 표시 |
| **풀** | 타이틀 바 ↓ 버튼 |
| **강제 푸시** | 타이틀 바 ... → "강제 푸시" |

---

### 9. 스태시 (Stash) 관리

작업 중인 변경 사항을 잠시 보관했다가 나중에 되살립니다.

| 기능 | 방법 |
|---|---|
| **변경 사항 스태시** | 커밋 입력창 타이틀 바 📥 버튼, 또는 Stash 섹션 우클릭 → "변경 사항 스태시" |
| **복구 후 삭제 (pop)** | 스태시 항목 hover → ↩ 버튼, 또는 우클릭 → "복구 후 삭제 (pop)" |
| **복구 후 보존 (apply)** | 스태시 항목 우클릭 → "복구 후 보존 (apply)" |
| **스태시 삭제** | 스태시 항목 우클릭 → "스태시 삭제" |

---

### 10. 백업 브랜치

rebase 같은 위험한 작업 전에 복구 지점을 자동으로 남기고, 쌓인 백업을 정리합니다.

| 기능 | 방법 |
|---|---|
| **rebase 직전 백업** | rebase 실행 시 `backup/<branch>/<timestamp>` 브랜치 자동 생성 (옵션, 같은 HEAD면 재사용) |
| **백업 브랜치 정리** | 커밋 입력창 타이틀 바 → "백업 브랜치 정리" (개수·기간 기준으로 오래된 백업 일괄 삭제) |

---

## 설치

```bash
# VSIX 패키징
./package.sh

# 설치
code --install-extension git-reflow-0.9.5.vsix
```

또는 VS Code에서: Extensions (Ctrl+Shift+X) → ... → Install from VSIX

## Contact
- Email: ddakker@gmail.com, ddakker@naver.com

## 개발 및 테스트 환경

- **Fedora Linux**: 주 개발·테스트 환경, 실무 상시 사용으로 가장 검증됨
- **Windows**: 테스트 진행
- **macOS**: 고려됨, 일부 지인이 실무에서 사용 중

## 라이센스

Apache-2.0
