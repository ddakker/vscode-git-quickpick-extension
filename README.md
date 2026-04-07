# Git QuickPick

VS Code 사이드바에서 모든 Git 작업을 수행하는 확장.

## 주요 기능

### 사이드바 구조

```
GIT QUICKPICK                    [전체선택][트리전환][커밋][Push][Pull][새로고침]
  MESSAGE INPUT
    커밋 메시지 입력 (Ctrl+Enter로 커밋)
    [Commit] 버튼 + 최근 메시지 히스토리

  WORKSPACE
    v Changes          master . 2개 변경
        [v] web.xml     M    [Rollback] [Delete]
        [v] App.java    M    [Rollback] [Delete]

    > History
        o 버그 수정           홍길동  2026-04-07 PM 08:45  a1b2c3d
        o 사용자 목록 추가    홍길동  2026-04-06 AM 10:30  e4f5g6h

    > Local Branches
        v master (현재)
          > (커밋 히스토리 + 파일 목록)
        feature/login

    > Remote Branches
        origin/master
        origin/develop
```

---

## Git Flow 가이드

### 1. 커밋 합치기 (Squash Commits)

여러 커밋을 하나로 합쳐서 히스토리를 깔끔하게 정리합니다.

```
사용 전                              사용 후
                                    
  o  fix: 오타 수정     (HEAD)        o  로그인 기능 구현    (HEAD)
  o  fix: 버그 수정                   o  이전 커밋
  o  feat: 로그인 구현                o  ...
  o  이전 커밋
  o  ...

  History에서 "feat: 로그인 구현" 우클릭
  → "Squash Commits from Here"
  → 3개 커밋이 1개로 합쳐짐
```

**사용 방법:**
1. History에서 합치기 시작할 커밋을 우클릭
2. **"Squash Commits from Here"** 선택
3. 커밋 메시지 입력 (기존 메시지들이 기본값으로 제공)
4. 커밋 시간 선택: "원래 커밋 시간 유지" 또는 "현재 시간 사용"

---

### 2. Rebase onto (리베이스)

현재 브랜치의 커밋들을 대상 브랜치 위로 재배치합니다. 히스토리가 깔끔해지지만 커밋 해시가 변경됩니다.

```
사용 전                              사용 후

  o  C3  (feature)                    o  C3' (feature, HEAD)
  o  C2                               o  C2'
  |                                   |
  | o  B2  (master)                   o  B2  (master)
  | o  B1                             o  B1
  |/                                  |
  o  A1                               o  A1

  Local Branches에서 "master" 우클릭
  → "Rebase onto master"
  → feature 브랜치가 master 위로 재배치됨
```

**사용 방법:**
1. Local/Remote Branches에서 대상 브랜치를 우클릭
2. **"Rebase onto {branch}"** 선택
3. 확인 다이얼로그에서 동작 설명 확인 후 진행
4. 충돌 시 3-way merge editor에서 해결 → Continue 버튼 클릭

---

### 3. Merge into (머지)

대상 브랜치의 변경사항을 현재 브랜치에 합칩니다. 머지 커밋이 생성되며 양쪽 히스토리가 보존됩니다.

```
사용 전                              사용 후

  o  C3  (feature, HEAD)              o  M   (feature, HEAD) ← 머지 커밋
  o  C2                               |\
  |                                   | o  B2  (master)
  | o  B2  (master)                   | o  B1
  | o  B1                             o  C3
  |/                                  o  C2
  o  A1                               |/
                                      o  A1

  Local Branches에서 "master" 우클릭
  → "Merge into feature"
  → master의 변경사항이 feature에 합쳐짐
```

**사용 방법:**
1. Local/Remote Branches에서 합칠 브랜치를 우클릭
2. **"Merge into {current branch}"** 선택
3. 확인 다이얼로그에서 동작 설명 확인 후 진행
4. 충돌 시 3-way merge editor에서 해결 → Continue 버튼 클릭

---

### 4. 충돌 해결 Flow

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

### 5. Cherry-pick

다른 브랜치의 특정 커밋을 현재 브랜치에 적용합니다.

```
사용 전                              사용 후

  o  C2  (feature, HEAD)              o  B2' (feature, HEAD) ← 체리픽
  o  C1                               o  C2
  |                                   o  C1
  | o  B2  (master) ← 이 커밋만!     |
  | o  B1                             | o  B2  (master)
  |/                                  | o  B1
  o  A1                               |/
                                      o  A1
```

**사용 방법:**
1. Local/Remote Branches에서 브랜치를 펼침
2. 커밋 목록에서 원하는 커밋을 우클릭
3. **"Cherry Pick"** 선택

---

### 6. 브랜치 관리

| 기능 | 방법 |
|---|---|
| **브랜치 생성** | Local Branches 섹션 우클릭 → "Create Branch" |
| **브랜치 전환** | 브랜치 우클릭 → "Switch Branch" |
| **Pull from Remote** | 브랜치 우클릭 → "Pull from Remote" |
| **Force Pull** | 브랜치 우클릭 → "Force Pull from Remote" (확인 2회) |
| **원격 브랜치 체크아웃** | Remote Branches에서 우클릭 → "Switch Branch" (로컬 트래킹 자동 생성) |

---

### 7. 커밋 & 변경 사항

| 기능 | 방법 |
|---|---|
| **커밋** | 파일 체크 → 메시지 입력 → Commit 버튼 또는 Ctrl+Enter |
| **파일 Diff 보기** | Changes/History 파일 **더블클릭** |
| **Rollback** | 파일 hover → ↩ 버튼 (마지막 커밋 시점으로 되돌림) |
| **삭제** | 파일 hover → 🗑 버튼 |
| **Soft Reset** | History 커밋 우클릭 → "Soft Reset" |
| **Hard Reset** | History 커밋 우클릭 → "Hard Reset" |
| **Push** | 타이틀 바 ☁ 버튼 |
| **Pull** | 타이틀 바 ↓ 버튼 |
| **Force Push** | 타이틀 바 ... → "Force Push" |

---

## 설치

```bash
# VSIX 패키징
./package.sh

# 설치
code --install-extension git-reflow-0.9.0.vsix
```

또는 VS Code에서: Extensions (Ctrl+Shift+X) → ... → Install from VSIX

## 라이센스

Apache-2.0
