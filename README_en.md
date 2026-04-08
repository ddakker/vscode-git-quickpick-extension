# Git QuickPick

VS Code sidebar extension for all Git operations.

> [한국어](README.md)

## Typical Workflow

A common development workflow using Git QuickPick:

```
1. Create Branch     Create a bug/feature branch from main (or develop)
       ↓                using "Create Branch"
2. Develop           Commit freely during development
       ↓
3. Complete          Finish development on the branch
       ↓
4. Squash            Combine messy commits into one clean commit
       ↓                using "Squash Commits from Here"
5. Rebase onto       Rebase current onto target branch to place
       ↓                base branch changes below current branch
6. Final Test        Run final tests after rebase
       ↓
7. Merge into        Switch to main (or develop) and
                        merge the bug/feature branch using "Merge this into current"

  ── Optional ─────────────────────────────────────────────

8. Cherry Pick       Apply the fix to other version branches as well
                        e.g. cherry-pick a bugfix merged into main onto 2.1.x,
                             and also onto 2.0.x if needed
```

---

## Sidebar Layout

```
GIT QUICKPICK                    [Select All/Deselect All][Toggle File/Tree View][Commit checked files][Push][Pull][Refresh]
  Message Input
    Commit message input (Ctrl+Enter to commit)
    [Commit] button + recent message history

  Workspace
    v Changes          main . 2 changes
        [v] web.xml     M    [Rollback] [Delete File]
        [v] App.java    M    [Rollback] [Delete File]

    > History
        o Bug fix              John  2026-04-07 PM 08:45  a1b2c3d
        o Add user list        John  2026-04-06 AM 10:30  e4f5g6h

    > Local Branches
        v main (current)
          > (commit history + file list)
        feature/login

    > Remote Branches
        origin/main
        origin/develop
```

---

## Features

### 1. Squash Commits from Here

Combine multiple commits into one to keep history clean.

```
Before                               After

  o  fix: typo          (HEAD)        o  Login feature       (HEAD)
  o  fix: bug fix                     o  previous commit
  o  feat: login impl                 o  ...
  o  previous commit
  o  ...

  Right-click "feat: login impl" in History
  → "Squash Commits from Here"
  → 3 commits merged into 1
```

**How to use:**
1. Right-click the starting commit in History
2. Select **"Squash Commits from Here"**
3. Existing commit messages auto-fill in the sidebar input (multiline editing)
4. Button changes to **"Squash Commits"** — click or Ctrl+Enter
5. Choose commit time: "Keep original" or "Use current time"

---

### 2. Edit Commit Message (Amend)

Edit the message of the latest commit.

```
Before                               After

  o  fix: tyop          (HEAD)        o  fix: typo           (HEAD)
  o  previous commit                  o  previous commit
  o  ...                              o  ...
```

**How to use:**
1. Right-click the **latest commit** in History
2. Select **"Edit Commit Message"**
3. Edit in sidebar input → click **"Edit Message"** button
4. Choose commit time: "Keep original" or "Use current time"

> Only available for the latest commit.

---

### 3. Rebase current onto this

Rebase current branch commits on top of the target branch. History becomes linear but commit hashes change.

```
Before                               After

  o  C3  (feature)                    o  C3' (feature, HEAD)
  o  C2                               o  C2'
  |                                   |
  | o  B2  (main)                   o  B2  (main)
  | o  B1                             o  B1
  |/                                  |
  o  A1                               o  A1

  Right-click "main" in Local Branches
  → "Rebase current onto this"
  → feature branch rebased on top of main
```

**How to use:**
1. Right-click the target branch in Local/Remote Branches
2. Select **"Rebase current onto this"**
3. Confirm in the dialog
4. On conflict: resolve in 3-way merge editor → click Continue

---

### 4. Merge this into current

Merge target branch changes into the current branch. Creates a merge commit preserving both histories.

```
Before                               After

  o  C3  (feature, HEAD)              o  M   (feature, HEAD) ← merge commit
  o  C2                               |\
  |                                   | o  B2  (main)
  | o  B2  (main)                   | o  B1
  | o  B1                             o  C3
  |/                                  o  C2
  o  A1                               |/
                                      o  A1

  Right-click "main" in Local Branches
  → "Merge this into current"
  → main changes merged into feature
```

**How to use:**
1. Right-click the branch to merge in Local/Remote Branches
2. Select **"Merge this into current"**
3. Confirm in the dialog
4. On conflict: resolve in 3-way merge editor → click Continue

---

### 5. Conflict Resolution Flow

When conflicts occur during Rebase/Merge/Cherry-pick:

```
Conflict detected
  │
  ├─ Notification: "Resolve in editor" / "Cancel" / "Open terminal"
  │
  ├─ "Resolve in editor"
  │     → 3-way Merge Editor opens (Current | Incoming | Result)
  │     → Resolve conflicts in the Result pane
  │
  ├─ Sidebar buttons appear:
  │     [▶ Continue Rebase]  ← click after resolving
  │     [✕ Abort Rebase]     ← cancel operation
  │
  └─ Click Continue
        → git add . + git rebase --continue
        → repeat if more conflicts
        → done
```

---

### 6. Cherry Pick

Apply a specific commit from another branch to the current branch.

```
Before                               After

  o  C2  (feature, HEAD)              o  B2' (feature, HEAD) ← cherry-pick
  o  C1                               o  C2
  |                                   o  C1
  | o  B2  (main) ← this one!      |
  | o  B1                             | o  B2  (main)
  |/                                  | o  B1
  o  A1                               |/
                                      o  A1
```

**How to use:**
1. Expand a branch in Local/Remote Branches
2. Right-click the desired commit
3. Select **"Cherry Pick"**

---

### 7. Branch Management

| Feature | How |
|---|---|
| **Create Branch** | Right-click Local Branches section → "Create Branch" |
| **Switch Branch** | Right-click branch → "Switch Branch" |
| **Pull from Remote** | Right-click branch → "Pull from Remote" |
| **Force Pull from Remote** | Right-click branch → "Force Pull from Remote" (2 confirmations) |
| **Remote Checkout** | Right-click in Remote Branches → "Switch Branch" (auto-creates local tracking) |

---

### 8. Commit & Changes

| Feature | How |
|---|---|
| **Commit checked files** | Check files → enter message → Commit button or Ctrl+Enter |
| **View Diff** | **Double-click** file in Changes/History |
| **Rollback** | Hover file → ↩ button (revert to last commit) |
| **Delete File** | Hover file → trash button |
| **Edit Commit Message** | Right-click latest commit in History → "Edit Commit Message" |
| **Squash Commits** | Right-click commit in History → "Squash Commits from Here" |
| **Soft Reset** | Right-click commit in History → "Soft Reset" |
| **Hard Reset** | Right-click commit in History → "Hard Reset" |
| **Push** | Title bar cloud button |
| **Pull** | Title bar ↓ button |
| **Force Push** | Title bar ... → "Force Push" |

---

## Installation

```bash
# Package VSIX
./package.sh

# Install
code --install-extension git-reflow-0.9.0.vsix
```

Or in VS Code: Extensions (Ctrl+Shift+X) → ... → Install from VSIX

## License

Apache-2.0
