'use strict';

// ─────────────────────────────────────────────────────────────────────
// webview HTML 생성 — VS Code API 의존 없는 순수 함수.
//
//  - renderLists(state, labels): 히스토리/브랜치 리스트 영역 HTML (서버사이드 렌더 → 테스트 가능).
//  - renderShell({nonce, cspSource, labels, config}): 페이지 골격(CSS + 클라이언트 JS).
//
// 색상은 var(--vscode-*) 토큰만 사용(라이트/다크/고대비 호환, 외부#4).
// bright = --vscode-foreground, dim = --vscode-descriptionForeground.
// ─────────────────────────────────────────────────────────────────────

const FIELD_LABEL_KEY = { message: 'message', date: 'date', author: 'author', hash: 'hash' };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 커밋 필드 값 추출 (commit-format 의 COMMIT_FIELD_VALUE 와 동일 규칙)
function fieldValue(commit, field) {
  if (field === 'hash') return (commit.hash || '').substring(0, 8);
  if (field === 'message') return commit.message || '';
  if (field === 'author') return commit.author || '';
  if (field === 'date') return commit.date || '';
  return '';
}

// 파일 상태 코드 → 표시 글자 (lib/git 의 fileStatusLetter 와 동일 규칙)
function fileLetter(code) {
  if (code === 'M') return 'U';
  if (code === 'A' || code === '?') return 'A';
  if (code === 'D') return 'D';
  return code || '';
}

// 커밋 한 행을 <tr> 로 렌더. 첫 셀에 펼침 chevron, fieldStyles 로 bright/dim.
function renderCommitRow(commit, ctx, config, expanded, section = '', labels = null) {
  const chevron = `<span class="chevron">${expanded ? '▾' : '▸'}</span>`;
  const cells = config.fieldOrder.map((f, i) => {
    const style = config.fieldStyles[f] === 'bright' ? 'bright' : 'dim';
    const isMsg = f === 'message';
    const w = config.fieldWidths[f];
    const cls = `cell ${style}${isMsg ? ' msg' : ' meta'}`;
    const styleAttr = !isMsg && w ? ` style="width:${Number(w)}px"` : '';
    const prefix = i === 0 ? chevron : '';
    const suffix = isMsg ? renderCommitActions(ctx, labels) : '';
    return `<td class="${cls}"${styleAttr}>${prefix}${esc(fieldValue(commit, f))}${suffix}</td>`;
  }).join('');
  return `<tr class="commit-row" role="row" tabindex="-1"`
    + ` data-kind="commit" data-hash="${esc(commit.hash)}" data-ctx="${esc(ctx)}"`
    + (section ? ` data-section="${esc(section)}"` : '')
    + ` aria-expanded="${expanded ? 'true' : 'false'}"`
    + ` title="${esc(commitTooltip(commit))}">${cells}</tr>`;
}

// 펼친 커밋의 변경 파일 목록을 colspan 하위행으로 렌더
function renderCommitFiles(hash, files, colspan, labels) {
  const inner = (!files || files.length === 0)
    ? `<div class="empty">${esc(labels.noDiffFiles || '')}</div>`
    : files.map(f => {
      const letter = fileLetter(f.statusCode);
      const ctx = f.statusCode === 'D' ? 'commitFileDeleted' : 'commitFile';
      return `<div class="cfile" data-kind="file" data-ctx="${ctx}"`
        + ` data-hash="${esc(hash)}" data-file="${esc(f.filePath)}" title="${esc(f.filePath)}">`
        + `<span class="cfl cfl-${esc(letter)}">${esc(letter)}</span>`
        + `<span class="cfp">${esc(f.filePath)}</span>`
        + renderCommitFileActions(ctx, labels)
        + `</div>`;
    }).join('');
  return `<tr class="cfiles-row"><td class="cfiles" colspan="${colspan}">${inner}</td></tr>`;
}

function commitTooltip(c) {
  return `${c.date || ''} · ${c.author || ''} · ${(c.hash || '').substring(0, 8)}\n${c.message || ''}`;
}

// 커밋 테이블 (히스토리/브랜치 히스토리 공통).
// expandedKeys: "section|hash" 복합 키 배열. 비어 있으면 commitFiles 전체를 펼침(하위 호환).
function renderCommitTable(commits, ctx, config, labels, commitFiles = {}, expandedKeys = [], section = '') {
  if (!commits) return `<div class="loading">${esc(labels.loading)}</div>`;
  if (commits.length === 0) return `<div class="empty">${esc(labels.noCommits)}</div>`;
  // 이 섹션에서 펼쳐야 할 해시 집합
  let sectionHashes;
  if (expandedKeys.length > 0 && section) {
    const prefix = section + '|';
    sectionHashes = new Set(
      expandedKeys.filter(k => k.startsWith(prefix)).map(k => k.split('|').pop())
    );
  } else {
    sectionHashes = new Set(Object.keys(commitFiles)); // 하위 호환 폴백
  }
  const colspan = config.fieldOrder.length;
  const rows = commits.map((c, i) => {
    // 히스토리의 최신(첫) 커밋은 historyCommitLatest (amend 메뉴 추가용)
    const rowCtx = (ctx === 'historyCommit' && i === 0) ? 'historyCommitLatest' : ctx;
    const isExp = sectionHashes.has(c.hash) && Object.prototype.hasOwnProperty.call(commitFiles, c.hash);
    const row = renderCommitRow(c, rowCtx, config, isExp, section, labels);
    return isExp ? row + renderCommitFiles(c.hash, commitFiles[c.hash], colspan, labels) : row;
  }).join('');
  return `<table class="commits" role="table"><tbody>${rows}</tbody></table>`;
}

function sectionHeader(section, label, expanded) {
  const chevron = expanded ? '▾' : '▸';
  // 일부 섹션 헤더는 우클릭 메뉴를 가짐(로컬=브랜치 생성, 스태시=스태시 생성) — master 동일
  const sectionMenuCtx = { localBranch: 'localBranchSection', stash: 'stashSection' };
  const ctxAttr = sectionMenuCtx[section] ? ` data-ctx="${sectionMenuCtx[section]}"` : '';
  return `<div class="section-header" role="button" tabindex="0"`
    + ` data-kind="section" data-section="${esc(section)}"${ctxAttr} aria-expanded="${expanded ? 'true' : 'false'}">`
    + `<span class="chevron">${chevron}</span><span class="section-title">${esc(label)}</span></div>`;
}

function renderBranchRow(branch, isRemote, config, labels, branchHistory, expanded, commitFiles, branchHistoryHasMore, expandedKeys = []) {
  const ctx = isRemote ? 'remoteBranch' : (branch.isCurrent ? 'localBranchCurrent' : 'localBranch');
  const cur = branch.isCurrent ? ` <span class="current">${esc(labels.current)}</span>` : '';
  const icon = isRemote ? (branch.unfetched ? '☁⤓' : '☁') : (branch.isCurrent ? '✓' : '⎇');
  const isExpanded = !!expanded[branch.name];
  const chevron = isExpanded ? '▾' : '▸';
  const header = `<div class="branch-row" role="button" tabindex="0"`
    + ` data-kind="branch" data-branch="${esc(branch.name)}" data-ctx="${esc(ctx)}"`
    + ` data-unfetched="${branch.unfetched ? '1' : '0'}" aria-expanded="${isExpanded ? 'true' : 'false'}">`
    + `<span class="chevron">${chevron}</span><span class="bicon">${icon}</span>`
    + `<span class="bname">${esc(branch.name)}${cur}</span>`
    + `<span class="bdesc">${esc(branch.description || '')}</span></div>`;
  let sub = '';
  if (isExpanded) {
    const branchSection = `branch|${branch.name}`;
    let commitHtml = renderCommitTable(branchHistory[branch.name], 'branchHistoryCommit', config, labels, commitFiles, expandedKeys, branchSection);
    if (branchHistoryHasMore && branchHistoryHasMore[branch.name]) {
      commitHtml += `<div class="load-more" data-kind="loadMore" data-section="branch"`
        + ` data-branch="${esc(branch.name)}">${esc(labels.loadMore || '')}</div>`;
    }
    sub = `<div class="branch-history">${commitHtml}</div>`;
  }
  return header + sub;
}

// ─── 변경 사항 / 스태시 (workspaceInWebview 옵션 ON 일 때만) ──────────

// 경로를 디렉터리/파일명으로 분리 (path 모듈 비의존 — 순수 유지)
function splitPath(p) {
  const i = String(p).lastIndexOf('/');
  return i < 0 ? { dir: '', base: p } : { dir: p.substring(0, i), base: p.substring(i + 1) };
}

// 변경 파일의 contextValue (트리 _createFileItem 과 동일 규칙)
function changeFileCtx(f) {
  if (f.isConflict) return 'fileConflict';
  if (f.statusCode === '?') return 'fileUntracked';
  if (f.statusCode === 'M') return 'fileModified';
  if (f.statusCode === 'D') return 'fileDeleted';
  return 'fileOther';
}

// 커밋 행 hover 인라인 액션
const COMMIT_ACTIONS = {
  copyHash:    { icon: '#',  cmd: 'gitReflow.copyHash' },
  copyMessage: { icon: '✍', cmd: 'gitReflow.copyMessage' },
  amend:       { icon: '✎', cmd: 'gitReflow.execAmendMessage' },
  cherryPick:  { icon: '🍒', cmd: 'gitReflow.execCherryPick' },
};
const COMMIT_INLINE = {
  historyCommit:       ['copyHash', 'copyMessage'],
  historyCommitLatest: ['copyHash', 'copyMessage', 'amend'],
  branchHistoryCommit: ['copyHash', 'cherryPick'],
};

function renderCommitActions(ctx, labels) {
  const acts = COMMIT_INLINE[ctx] || [];
  if (!acts.length) return '';
  const titles = (labels && labels.commitActions) || {};
  return `<span class="cactions">`
    + acts.map(a => {
      const spec = COMMIT_ACTIONS[a];
      return `<span class="caction" data-cmd="${spec.cmd}" title="${esc(titles[a] || '')}">${spec.icon}</span>`;
    }).join('')
    + `</span>`;
}

// 커밋 파일 행 hover 인라인 액션
const COMMIT_FILE_ACTIONS = {
  openDiff:     { icon: '∆', cmd: 'gitReflow.openCommitFileDiff' },
  compareLocal: { icon: '⊞', cmd: 'gitReflow.openCommitFileVsLocal' },
  openCurrent:  { icon: '↗', cmd: 'gitReflow.openCurrentFile' },
};
const COMMIT_FILE_INLINE = {
  commitFile:        ['openDiff', 'compareLocal', 'openCurrent'],
  commitFileDeleted: ['openDiff', 'compareLocal'],
};

function renderCommitFileActions(ctx, labels) {
  const acts = COMMIT_FILE_INLINE[ctx] || [];
  if (!acts.length) return '';
  const titles = (labels && labels.commitFileActions) || {};
  return `<span class="cfactions">`
    + acts.map(a => {
      const spec = COMMIT_FILE_ACTIONS[a];
      return `<span class="cfaction" data-cmd="${spec.cmd}" title="${esc(titles[a] || '')}">${spec.icon}</span>`;
    }).join('')
    + `</span>`;
}

// 파일 행 hover 인라인 액션 (master 트리 view/item/context inline 그룹과 동일 구성).
const FILE_ACTIONS = {
  jumpToSource:            { icon: '↗',  cmd: 'gitReflow.jumpToSource' },
  stageFile:               { icon: '＋', cmd: 'gitReflow.stageFile' },
  rollbackFile:            { icon: '↩',  cmd: 'gitReflow.rollbackFile' },
  deleteFile:              { icon: '🗑', cmd: 'gitReflow.deleteFile' },
  openConflictMergeEditor: { icon: '⮂',  cmd: 'gitReflow.openConflictMergeEditor' },
  openConflictInEditor:    { icon: '✎',  cmd: 'gitReflow.openConflictInEditor' },
  acceptMerge:             { icon: '✔',  cmd: 'gitReflow.acceptMerge' },
};
const FILE_INLINE = {
  fileUntracked: ['jumpToSource', 'stageFile', 'deleteFile'],
  fileModified:  ['jumpToSource', 'rollbackFile', 'deleteFile'],
  fileDeleted:   ['rollbackFile'],
  fileOther:     ['jumpToSource', 'deleteFile'],
  fileConflict:  ['openConflictMergeEditor', 'openConflictInEditor', 'acceptMerge'],
};

function renderFileActions(ctx, labels, inProgress) {
  const acts = FILE_INLINE[ctx] || [];
  if (!acts.length) return '';
  const titles = (labels && labels.fileActions) || {};
  const renderBtn = (a) => {
    const spec = FILE_ACTIONS[a];
    return `<span class="chaction chaction-${a}" data-action="${a}" data-cmd="${spec.cmd}"`
      + ` title="${esc(titles[a] || '')}">${spec.icon}</span>`;
  };
  // 충돌 파일: 3버튼 모두 항상 노출 + 각각 다른 색상
  if (ctx === 'fileConflict') {
    return `<span class="chactions chactions-conflict">${acts.map(renderBtn).join('')}</span>`;
  }
  // 병합 중일 때 acceptMerge 버튼은 항상 보이는 별도 그룹으로 분리
  const primaryActs = inProgress ? acts.filter(a => a === 'acceptMerge') : [];
  const normalActs  = acts.filter(a => !primaryActs.includes(a));
  let html = '';
  if (normalActs.length) {
    html += `<span class="chactions">${normalActs.map(renderBtn).join('')}</span>`;
  }
  if (primaryActs.length) {
    html += `<span class="chactions chactions-merge">${primaryActs.map(renderBtn).join('')}</span>`;
  }
  return html;
}

// 변경 파일 한 행 (체크박스 + 상태글자 + 파일명 + 디렉터리 + hover 인라인 액션). depth 로 트리 들여쓰기.
function renderChangeFileRow(f, checked, labels, depth = 0, inProgress = null) {
  const { dir, base } = splitPath(f.filePath);
  const letter = f.isConflict ? 'C' : fileLetter(f.statusCode);
  const ctx = changeFileCtx(f);
  const isChecked = checked.has(f.filePath);
  const pad = 6 + depth * 12;
  const mergeHint = (f.isConflict && inProgress)
    ? `<span class="conflict-merge-hint">${esc(labels.acceptMergeHint || '')}</span>`
    : '';
  return `<div class="chfile" role="row" tabindex="-1" data-kind="changedFile" data-ctx="${ctx}"`
    + ` data-path="${esc(f.filePath)}" style="padding-left:${pad}px"`
    + ` title="${esc(f.filePath)} [${esc(letter)}]">`
    + `<input type="checkbox" class="cb"${isChecked ? ' checked' : ''}>`
    + `<span class="cfl cfl-${esc(letter)}">${esc(letter)}</span>`
    + `<span class="cfp">${esc(base)}</span>`
    + (dir ? `<span class="cfdir">${esc(dir)}</span>` : '')
    + mergeHint
    + renderFileActions(ctx, labels, inProgress)
    + `</div>`;
}

// 변경 파일을 디렉터리 트리로 묶는다 (tree 보기용)
function buildChangeTree(changes) {
  const root = { dirs: new Map(), files: [] };
  for (const f of changes) {
    const parts = f.filePath.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts[i];
      if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: [] });
      node = node.dirs.get(d);
    }
    node.files.push(f);
  }
  return root;
}

// 트리 노드 재귀 렌더. 폴더 접기/펼치기는 클라이언트(JS)에서만 처리.
function renderChangeTreeNode(node, checked, labels, depth, inProgress) {
  let html = '';
  for (const [name, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const pad = 6 + depth * 12;
    html += `<div class="chdir" role="button" tabindex="-1" style="padding-left:${pad}px">`
      + `<span class="chevron">▾</span><span class="cfl">📁</span>`
      + `<span class="cfp">${esc(name)}</span></div>`;
    html += `<div class="chdir-body">${renderChangeTreeNode(child, checked, labels, depth + 1, inProgress)}</div>`;
  }
  for (const f of node.files) {
    html += renderChangeFileRow(f, checked, labels, depth, inProgress);
  }
  return html;
}

// 변경 사항 섹션 (맨 위). 체크박스/전체선택/list·tree 보기.
function renderChanges(state, labels) {
  const exp = state.expanded || {};
  const changes = state.changes || [];
  const checked = state.checkedFiles instanceof Set
    ? state.checkedFiles : new Set(state.checkedFiles || []);
  const mode = state.fileViewMode === 'tree' ? 'tree' : 'list';
  const isOpen = exp.changes !== false; // 기본 펼침
  const count = changes.length;

  const chevron = isOpen ? '▾' : '▸';
  const toggleIcon = mode === 'tree' ? '⊞' : '☰';
  const parts = [`<div class="section">`];
  parts.push(
    `<div class="section-header changes-header" role="button" tabindex="0"`
    + ` data-kind="section" data-section="changes" aria-expanded="${isOpen ? 'true' : 'false'}">`
    + `<span class="chevron">${chevron}</span>`
    + `<span class="section-title">${esc(labels.sectionCommit)}</span>`
    + (count ? `<span class="sec-count">${count}</span>` : '')
    + (state.currentBranch
      ? `<span class="cur-branch" title="${esc(state.currentBranch)}">⎇ ${esc(state.currentBranch)}</span>`
      : '')
    + (count > 0
      ? (() => {
          const allChecked = changes.every(f => checked.has(f.filePath));
          return `<span class="select-all-btn${allChecked ? ' checked' : ''}" data-kind="selectAll"`
            + ` data-checked="${allChecked}" title="${esc(labels.selectAll)}">`
            + `${allChecked ? '☑' : '☐'}</span>`;
        })()
      : '')
    + `<span class="view-toggle" data-kind="fileViewToggle" title="${esc(labels.toggleFileView)}">${toggleIcon}</span>`
    + (mode === 'tree' ? `<span class="header-btn-sep"></span><span class="tree-toggle-all" data-kind="treeToggleAll" title="${esc(labels.treeToggleAll || '전체 펼치기/닫기')}">⊟</span>` : '')
    + `</div>`
  );
  if (isOpen) {
    let body;
    if (count === 0) {
      body = `<div class="empty">${esc(labels.noChanges)}</div>`;
    } else {
      const inProgress = state.inProgress || null;
      const filesHtml = mode === 'tree'
        ? renderChangeTreeNode(buildChangeTree(changes), checked, labels, 0, inProgress)
        : changes.map(f => renderChangeFileRow(f, checked, labels, 0, inProgress)).join('');
      body = filesHtml;
    }
    parts.push(`<div class="section-body">${body}</div>`);
  }
  parts.push(`</div>`);
  return parts.join('');
}

// 스태시 항목 한 행 (펼치면 파일 목록)
function renderStashRow(s, stashFiles, labels) {
  const isExp = Object.prototype.hasOwnProperty.call(stashFiles, s.ref);
  const chevron = isExp ? '▾' : '▸';
  const header = `<div class="stash-row" role="button" tabindex="0"`
    + ` data-kind="stash" data-ctx="stashEntry" data-ref="${esc(s.ref)}"`
    + ` aria-expanded="${isExp ? 'true' : 'false'}" title="${esc(s.ref)} ${esc(s.message)}">`
    + `<span class="chevron">${chevron}</span><span class="bicon">📦</span>`
    + `<span class="bname">${esc(s.message)}</span>`
    + `<span class="bdesc">${esc(s.ref)}  ${esc(s.relTime)}</span></div>`;
  let sub = '';
  if (isExp) {
    const files = stashFiles[s.ref] || [];
    const inner = files.length === 0
      ? `<div class="empty">${esc(labels.noDiffFiles)}</div>`
      : files.map(f => {
        const { dir, base } = splitPath(f.filePath);
        const letter = fileLetter(f.statusCode);
        return `<div class="chfile" role="row" tabindex="-1" data-kind="stashFile" data-ctx="stashFile"`
          + ` data-ref="${esc(s.ref)}" data-path="${esc(f.filePath)}" title="${esc(f.filePath)}">`
          + `<span class="cfl cfl-${esc(letter)}">${esc(letter)}</span>`
          + `<span class="cfp">${esc(base)}</span>`
          + (dir ? `<span class="cfdir">${esc(dir)}</span>` : '')
          + `</div>`;
      }).join('');
    sub = `<div class="stash-files">${inner}</div>`;
  }
  return header + sub;
}

// 스태시 섹션 (맨 아래)
function renderStash(state, labels) {
  const exp = state.expanded || {};
  const isOpen = !!exp.stash;
  const parts = [`<div class="section">`];
  parts.push(sectionHeader('stash', labels.sectionStash, isOpen));
  if (isOpen) {
    const stashes = state.stashes || [];
    const sf = state.stashFiles || {};
    const body = stashes.length === 0
      ? `<div class="empty">${esc(labels.noStash)}</div>`
      : stashes.map(s => renderStashRow(s, sf, labels)).join('');
    parts.push(`<div class="section-body">${body}</div>`);
  }
  parts.push(`</div>`);
  return parts.join('');
}

// 리스트 영역 전체 HTML (#lists 안에 들어갈 내용). 서버사이드 렌더 → 테스트 가능.
function renderLists(state, labels) {
  const config = state.config;
  const exp = state.expanded || {};
  const cf = state.commitFiles || {};
  const expandedKeys = state.expandedCommitKeys || [];
  const parts = [];

  // 진행 중 배너
  if (state.inProgress) {
    const opLabel = labels.inProgress[state.inProgress] || state.inProgress;
    const contLabel = (labels.continueLabels && labels.continueLabels[state.inProgress])
      || labels.continue || '';
    const abrtLabel = (labels.abortLabels && labels.abortLabels[state.inProgress])
      || labels.abort || '';
    parts.push(
      `<div class="banner" role="alert">`
      + `<span class="banner-text">${esc(opLabel)}</span>`
      + `<button class="banner-btn continue" data-kind="op" data-op="continue">${esc(contLabel)}</button>`
      + `<button class="banner-btn abort" data-kind="op" data-op="abort">${esc(abrtLabel)}</button>`
      + `</div>`
    );
  }

  // 변경 사항 섹션 (히스토리 위)
  parts.push(renderChanges(state, labels));

  const hasMore = state.branchHistoryHasMore || {};

  // 히스토리 섹션
  parts.push(`<div class="section">`);
  parts.push(sectionHeader('history', labels.sectionHistory, !!exp.history));
  if (exp.history) {
    let body = renderCommitTable(state.history, 'historyCommit', config, labels, cf, expandedKeys, 'history');
    if (state.historyHasMore) {
      body += `<div class="load-more" data-kind="loadMore" data-section="history">${esc(labels.loadMore || '')}</div>`;
    }
    parts.push(`<div class="section-body">${body}</div>`);
  }
  parts.push(`</div>`);

  // 로컬 브랜치 섹션
  parts.push(`<div class="section">`);
  parts.push(sectionHeader('localBranch', labels.sectionLocalBranch, !!exp.localBranch));
  if (exp.localBranch) {
    const rows = (state.localBranches || []).map(b =>
      renderBranchRow(b, false, config, labels, state.branchHistory || {}, exp, cf, hasMore, expandedKeys)).join('');
    parts.push(`<div class="section-body">${rows || `<div class="empty">${esc(labels.noBranches)}</div>`}</div>`);
  }
  parts.push(`</div>`);

  // 원격 브랜치 섹션
  parts.push(`<div class="section">`);
  parts.push(sectionHeader('remoteBranch', labels.sectionRemoteBranch, !!exp.remoteBranch));
  if (exp.remoteBranch) {
    const rows = (state.remoteBranches || []).map(b =>
      renderBranchRow(b, true, config, labels, state.branchHistory || {}, exp, cf, hasMore, expandedKeys)).join('');
    parts.push(`<div class="section-body">${rows || `<div class="empty">${esc(labels.noBranches)}</div>`}</div>`);
  }
  parts.push(`</div>`);

  // 스태시 섹션 (원격 브랜치 아래)
  parts.push(renderStash(state, labels));

  return parts.join('\n');
}

// 페이지 골격 — CSS + 빈 컨테이너 + 클라이언트 JS (innerHTML 교체 + 클릭/메뉴/툴바).
function renderShell({ nonce, cspSource, labels, menu, inputPosition }) {
  const csp = `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; `
    + `script-src 'nonce-${nonce}'; img-src ${cspSource} data:;`;
  const pos = ['top', 'bottom'].includes(inputPosition) ? inputPosition : 'bottom';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px);
         color: var(--vscode-foreground); display: flex; flex-direction: column; height: 100vh; }
  /* 툴바 버튼은 네이티브 뷰 타이틀바(view/title)로 — master 와 동일 배치 */
  /* 입력 영역 — 위치(top/bottom/hidden)는 body class 로 제어 (요구 2). 리스트 재렌더와 분리(A1). */
  #inputarea { order: 1; padding: 4px; border-bottom: 1px solid var(--vscode-panel-border); }
  body.pos-bottom #inputarea { order: 3; border-bottom: none; border-top: 1px solid var(--vscode-panel-border); }
  /* showInputWhenChecked: 체크된 파일이 없으면 입력창 숨김 */
  body.input-hidden #inputarea { display: none; }
  #lists { order: 2; flex: 1 1 auto; overflow-y: auto; }
  .input-wrap { display: flex; align-items: flex-start; gap: 2px; }
  #msg { flex: 1; height: 52px; padding: 4px 6px; resize: none; outline: none; border-radius: 2px;
         border: 1px solid var(--vscode-input-border, #3c3c3c); background: var(--vscode-input-background);
         color: var(--vscode-input-foreground); font-family: var(--vscode-font-family);
         font-size: var(--vscode-font-size, 13px); line-height: 1.4; }
  #msg:focus { border-color: var(--vscode-focusBorder); }
  #historyBtn { flex-shrink: 0; width: 26px; height: 26px; cursor: pointer; border-radius: 2px;
                border: 1px solid var(--vscode-input-border, #3c3c3c); background: var(--vscode-input-background);
                color: var(--vscode-descriptionForeground); }
  #historyBtn:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
  #commitBtn { width: 100%; margin-top: 4px; padding: 4px 0; border: none; border-radius: 2px; cursor: pointer;
               background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #commitBtn:hover { background: var(--vscode-button-hoverBackground); }
  #cancelBtn { width: 100%; margin-top: 2px; padding: 4px 0; border-radius: 2px; cursor: pointer;
               border: 1px solid var(--vscode-input-border, #3c3c3c);
               background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .section-header, .branch-row, .commit-row { cursor: default; }
  /* 섹션 전체(헤더+하위 트리)에 왼쪽 여백을 줘서 정렬을 맞춘다 */
  .section { padding-left: 14px; }
  .section-header { display: flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px; font-weight: 600;
                    user-select: none; }
  .section-header:hover, .branch-row:hover { background: var(--vscode-list-hoverBackground); }
  /* 펼친 하위 목록(커밋/브랜치)을 섹션 헤더 아래로 들여쓰기 (트리 중첩) */
  .section-body { padding-left: 12px; }
  .chevron { display: inline-block; width: 12px; color: var(--vscode-descriptionForeground); cursor: pointer; }
  table.commits { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .commit-row { height: 22px; }
  .commit-row:hover { background: var(--vscode-list-hoverBackground); }
  .commit-row:focus, .branch-row:focus, .section-header:focus {
    outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  td.cell { padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            vertical-align: middle; line-height: 22px; }
  td.bright { color: var(--vscode-foreground); }
  td.dim { color: var(--vscode-descriptionForeground); }
  td.msg { width: 100%; max-width: 0; }
  td.meta { font-family: var(--vscode-editor-font-family, monospace); text-align: left; }
  .cactions { display: none; gap: 1px; vertical-align: middle; margin-left: 4px; }
  .commit-row:hover .cactions, .commit-row:focus .cactions { display: inline-flex; align-items: center; }
  .caction { cursor: pointer; min-width: 18px; text-align: center; padding: 0 3px; border-radius: 3px;
             color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 20px; }
  .caction:hover { color: var(--vscode-foreground);
                   background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  td.cfiles { padding: 0 0 2px 0; }
  .cfile { display: flex; align-items: center; gap: 6px; height: 20px; padding: 0 6px 0 18px; cursor: pointer; }
  .cfile:hover { background: var(--vscode-list-hoverBackground); }
  .cfactions { flex-shrink: 0; display: none; gap: 1px; }
  .cfile:hover .cfactions, .cfile:focus .cfactions { display: flex; align-items: center; }
  .cfaction { cursor: pointer; min-width: 18px; text-align: center; padding: 0 3px; border-radius: 3px;
              color: var(--vscode-descriptionForeground); font-size: 12px; }
  .cfaction:hover { color: var(--vscode-foreground);
                    background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .cfl { flex-shrink: 0; width: 12px; text-align: center; font-family: var(--vscode-editor-font-family, monospace);
         color: var(--vscode-descriptionForeground); }
  .cfl-A { color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-charts-green)); }
  .cfl-U { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-charts-blue)); }
  .cfl-D { color: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-charts-red)); }
  .cfp { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .branch-row { display: flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px; }
  .bicon { width: 14px; color: var(--vscode-descriptionForeground); text-align: center; }
  .bname { flex-shrink: 0; }
  .current { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-charts-blue)); font-size: 11px; }
  .bdesc { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .branch-history { padding-left: 12px; }
  /* ─ 변경 사항 / 스태시 ─ */
  .sec-count { color: var(--vscode-descriptionForeground); font-weight: normal; font-size: 11px; margin-left: 8px; }
  /* 변경 사항 헤더 우측의 현재 브랜치 이름 (항상 보임) */
  .cur-branch { color: var(--vscode-descriptionForeground); font-weight: normal; font-size: 11px;
                margin-left: 12px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* 트리뷰 전환 — 정보 텍스트(갯수·브랜치)와 달리 클릭 가능한 버튼임을 테두리/배경으로 표현 */
  .select-all-btn { cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
                    width: 20px; height: 18px; padding: 0; margin-left: 4px; font-size: 13px; line-height: 1;
                    border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 3px;
                    background: var(--vscode-button-secondaryBackground); color: var(--vscode-descriptionForeground); }
  .select-all-btn:hover { color: var(--vscode-button-secondaryForeground);
                          background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  .select-all-btn.checked { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .view-toggle { cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
                 width: 24px; height: 18px; padding: 0; margin-left: 4px; font-size: 12px; line-height: 1;
                 border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 3px;
                 background: var(--vscode-button-secondaryBackground); color: var(--vscode-descriptionForeground); }
  .view-toggle:hover { color: var(--vscode-button-secondaryForeground);
                       background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  .select-all, .chfile, .chdir, .stash-row {
    display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 6px; }
  .select-all, .chfile { cursor: pointer; }
  .chdir, .stash-row { cursor: default; }
  .select-all:hover, .chfile:hover, .chdir:hover, .stash-row:hover { background: var(--vscode-list-hoverBackground); }
  .chfile:focus, .stash-row:focus, .select-all:focus, .chdir:focus {
    outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  input.cb { flex-shrink: 0; margin: 0; cursor: pointer; }
  .cfdir { color: var(--vscode-descriptionForeground); font-size: 11px;
           overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* 파일 행 hover 인라인 액션 (트리와 동일) */
  .chactions { flex-shrink: 0; display: flex; gap: 1px; visibility: hidden; }
  .chfile:hover .chactions, .chfile:focus .chactions { visibility: visible; }
  .chactions-merge { visibility: visible; }
  .chaction { cursor: pointer; min-width: 18px; text-align: center; padding: 0 3px; border-radius: 3px;
              color: var(--vscode-descriptionForeground); }
  .chaction:hover { color: var(--vscode-foreground);
                    background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .chactions-merge .chaction { color: var(--vscode-charts-green, #89d185); font-weight: bold; }
  .chactions-merge .chaction:hover { color: var(--vscode-foreground);
                                     background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  /* 충돌 파일 3버튼: 항상 노출 + 각각 다른 색상 */
  .chactions-conflict { visibility: visible; }
  .chactions-conflict .chaction { font-size: 13px; min-width: 20px; padding: 1px 4px; }
  .chaction-openConflictMergeEditor { color: var(--vscode-charts-blue, #75beff) !important; }
  .chaction-openConflictInEditor { color: var(--vscode-charts-yellow, #cca700) !important; }
  .chaction-acceptMerge { color: var(--vscode-charts-green, #4ec94e) !important; font-weight: bold; }
  .chactions-conflict .chaction:hover { color: var(--vscode-foreground) !important;
                                        background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  /* 병합완료 힌트는 acceptMerge 버튼과 같은 색으로 연결감 강조 */
  .conflict-merge-hint { font-size: 0.8em; color: var(--vscode-charts-green, #4ec94e);
                         font-weight: bold; margin-left: 4px; white-space: nowrap; flex-shrink: 0; }
  .cfl-C { color: var(--vscode-gitDecoration-conflictingResourceForeground, var(--vscode-charts-orange)); }
  .chdir.collapsed > .chevron { transform: none; }
  .chdir-body.collapsed { display: none; }
  .header-btn-sep { width: 1px; height: 14px; background: var(--vscode-input-border, #3c3c3c); margin: 0 3px; flex-shrink: 0; }
  .tree-toggle-all { cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
                     width: 20px; height: 18px; padding: 0; font-size: 12px; line-height: 1;
                     border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 3px;
                     background: var(--vscode-button-secondaryBackground); color: var(--vscode-descriptionForeground); }
  .tree-toggle-all:hover { color: var(--vscode-button-secondaryForeground);
                           background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  .stash-row { gap: 4px; }
  .stash-files { padding-left: 12px; }
  .empty, .loading { padding: 4px 12px; color: var(--vscode-descriptionForeground); font-style: italic; }
  .load-more { display: flex; align-items: center; justify-content: center; padding: 4px 12px;
               cursor: pointer; font-size: 11px; color: var(--vscode-textLink-foreground, var(--vscode-descriptionForeground)); }
  .load-more:hover { background: var(--vscode-list-hoverBackground); text-decoration: underline; }
  .banner { position: sticky; top: 0; z-index: 1;
            display: flex; align-items: center; gap: 6px; padding: 6px 8px; margin: 4px;
            background: var(--vscode-inputValidation-warningBackground, rgba(255,200,0,0.1));
            border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border)); border-radius: 3px; }
  .banner-text { flex: 1; }
  .banner-btn { cursor: pointer; border: none; border-radius: 3px; padding: 3px 8px; }
  .banner-btn.continue { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .banner-btn.abort { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  #ctxmenu { position: fixed; z-index: 100; background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
             color: var(--vscode-menu-foreground, var(--vscode-foreground));
             border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); border-radius: 4px;
             padding: 4px 0; min-width: 160px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: none; }
  #ctxmenu .mi { padding: 4px 14px; cursor: pointer; white-space: nowrap; }
  #ctxmenu .mi:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
                       color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground)); }
  #ctxmenu .mi.disabled { color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
                           cursor: default; opacity: 0.5; pointer-events: none; }
</style>
</head>
<body class="pos-${pos}">
  <div id="inputarea">
    <div class="input-wrap">
      <textarea id="msg" rows="1" placeholder="${esc(labels.inputPlaceholder)}"></textarea>
      <button id="historyBtn" title="${esc(labels.inputRecent)}">⟲</button>
    </div>
    <button id="commitBtn">✓ ${esc(labels.inputCommit)}</button>
    <button id="cancelBtn" style="display:none"></button>
  </div>
  <div id="lists"></div>
  <div id="ctxmenu"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const lists = document.getElementById('lists');
    const menu = document.getElementById('ctxmenu');
    const ta = document.getElementById('msg');
    const commitBtn = document.getElementById('commitBtn');
    const cancelBtn = document.getElementById('cancelBtn');

    const MENU = ${JSON.stringify(menu || { commit: [], branch: [] })};

    window.addEventListener('message', (e) => {
      const m = e.data;
      if (m.type === 'render') { lists.innerHTML = m.listsHtml; }
      else if (m.type === 'clear') { ta.value = ''; }
      else if (m.type === 'restore') { ta.value = m.value; }
      else if (m.type === 'setButtonLabel') { commitBtn.textContent = m.value; }
      else if (m.type === 'showCancel') { cancelBtn.textContent = m.value; cancelBtn.style.display = ''; }
      else if (m.type === 'hideCancel') { cancelBtn.style.display = 'none'; }
      else if (m.type === 'inputPosition') {
        const hidden = document.body.classList.contains('input-hidden');
        document.body.className = 'pos-' + m.pos + (hidden ? ' input-hidden' : '');
      }
      else if (m.type === 'inputVisible') {
        const wasHidden = document.body.classList.contains('input-hidden');
        document.body.classList.toggle('input-hidden', !m.visible);
        // 체크로 입력창이 숨김→표시로 나타날 때만 입력창에 포커스
        if (m.visible && m.focus && wasHidden) ta.focus();
      }
      else if (m.type === 'focusInput') { ta.focus(); }
    });

    function hideMenu() { menu.style.display = 'none'; }
    document.addEventListener('click', hideMenu);
    document.addEventListener('scroll', hideMenu, true);
    // 웹뷰 밖(다른 패널/에디터)을 클릭해 포커스를 잃으면 메뉴 닫기
    window.addEventListener('blur', hideMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });

    // 입력 영역
    document.getElementById('historyBtn').addEventListener('click', () => vscode.postMessage({ type: 'showHistory' }));
    ta.addEventListener('input', () => vscode.postMessage({ type: 'input', value: ta.value }));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (ta.value.trim()) vscode.postMessage({ type: 'commit', value: ta.value });
      } else if (e.key === 'Escape' && cancelBtn.style.display !== 'none') {
        e.preventDefault();
        vscode.postMessage({ type: 'cancel' });
      }
    });
    commitBtn.addEventListener('click', () => { if (ta.value.trim()) vscode.postMessage({ type: 'commit', value: ta.value }); });
    cancelBtn.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

    // 파일 더블클릭 → 열기/diff
    lists.addEventListener('dblclick', (e) => {
      const cf = e.target.closest('.cfile');
      if (cf) { vscode.postMessage({ type: 'openCommitFile', hash: cf.dataset.hash, file: cf.dataset.file }); return; }
      const chf = e.target.closest('.chfile[data-kind="changedFile"]');
      if (chf) { vscode.postMessage({ type: 'openChangedFile', path: chf.dataset.path }); return; }
      const sf = e.target.closest('.chfile[data-kind="stashFile"]');
      if (sf) {
        vscode.postMessage({ type: 'command', command: 'gitReflow.jumpToSource',
          arg: { kind: 'stash', path: sf.dataset.path, ref: sf.dataset.ref, ctx: 'stashFile' } });
      }
    });

    // 리스트 클릭: 커밋·섹션·브랜치 토글 / 배너 op / 변경·스태시
    lists.addEventListener('click', (e) => {
      // 체크박스는 change 이벤트로 따로 처리 (클릭은 무시)
      if (e.target.classList && e.target.classList.contains('cb')) return;
      // 커밋 행 hover 인라인 액션 (해시복사/메시지복사/amend/체리픽)
      const cact = e.target.closest('.caction');
      if (cact) {
        e.stopPropagation();
        const row = cact.closest('.commit-row');
        if (row) vscode.postMessage({ type: 'command', command: cact.dataset.cmd,
          arg: { kind: 'commit', hash: row.dataset.hash, ctx: row.dataset.ctx } });
        return;
      }
      // 커밋 파일 행 hover 인라인 액션 (diff/비교/열기)
      const cfact = e.target.closest('.cfaction');
      if (cfact) {
        e.stopPropagation();
        const row = cfact.closest('.cfile');
        if (row) vscode.postMessage({ type: 'command', command: cfact.dataset.cmd,
          arg: { kind: 'file', hash: row.dataset.hash, file: row.dataset.file, ctx: row.dataset.ctx } });
        return;
      }
      // 변경 파일 hover 인라인 액션 (소스로 이동/되돌리기/삭제 등)
      const act = e.target.closest('.chaction');
      if (act) {
        e.stopPropagation();
        const row = act.closest('[data-kind="changedFile"]');
        if (row) vscode.postMessage({ type: 'command', command: act.dataset.cmd,
          arg: { kind: 'changedFile', path: row.dataset.path, ctx: row.dataset.ctx } });
        return;
      }
      // 트리 전체 펼치기/닫기
      const tta = e.target.closest('[data-kind="treeToggleAll"]');
      if (tta) {
        e.stopPropagation();
        const allDirs = [...lists.querySelectorAll('.chdir')];
        const anyCollapsed = allDirs.some(d => d.classList.contains('collapsed'));
        allDirs.forEach(dir => {
          const body = dir.nextElementSibling;
          const ch = dir.querySelector('.chevron');
          if (anyCollapsed) {
            dir.classList.remove('collapsed');
            if (body) body.classList.remove('collapsed');
            if (ch) ch.textContent = '▾';
          } else {
            dir.classList.add('collapsed');
            if (body) body.classList.add('collapsed');
            if (ch) ch.textContent = '▸';
          }
        });
        tta.textContent = anyCollapsed ? '⊟' : '⊞';
        return;
      }
      // list/tree 보기 전환 (섹션 토글보다 먼저 — 헤더 안에 있으므로)
      const vt = e.target.closest('[data-kind="fileViewToggle"]');
      if (vt) { e.stopPropagation(); vscode.postMessage({ type: 'toggleFileViewMode' }); return; }
      const sa = e.target.closest('[data-kind="selectAll"]');
      if (sa) {
        e.stopPropagation();
        const checked = sa.dataset.checked !== 'true';
        lists.querySelectorAll('.chfile input.cb').forEach(cb => { cb.checked = checked; });
        sa.dataset.checked = checked;
        sa.textContent = checked ? '☑' : '☐';
        if (checked) sa.classList.add('checked'); else sa.classList.remove('checked');
        vscode.postMessage({ type: 'selectAll', checked });
        return;
      }
      const op = e.target.closest('[data-kind="op"]');
      if (op) { vscode.postMessage({ type: 'op', op: op.dataset.op }); return; }
      // 폴더 접기/펼치기 — 클라이언트 전용 (provider 왕복 없음)
      const dir = e.target.closest('.chdir');
      if (dir && e.target.closest('.chevron')) {
        dir.classList.toggle('collapsed');
        const body = dir.nextElementSibling;
        if (body && body.classList.contains('chdir-body')) body.classList.toggle('collapsed');
        const ch = dir.querySelector('.chevron');
        if (ch) ch.textContent = dir.classList.contains('collapsed') ? '▸' : '▾';
        return;
      }
      const lm = e.target.closest('[data-kind="loadMore"]');
      if (lm) {
        vscode.postMessage({ type: 'loadMore', section: lm.dataset.section, branch: lm.dataset.branch || '' });
        return;
      }
      const sec = e.target.closest('[data-kind="section"]');
      if (sec && e.target.closest('.chevron')) { vscode.postMessage({ type: 'toggleSection', section: sec.dataset.section }); return; }
      const br = e.target.closest('[data-kind="branch"]');
      if (br && e.target.closest('.chevron')) { vscode.postMessage({ type: 'toggleBranch', branchName: br.dataset.branch, ctx: br.dataset.ctx }); return; }
      const st = e.target.closest('[data-kind="stash"]');
      if (st && e.target.closest('.chevron')) { vscode.postMessage({ type: 'toggleStashEntry', ref: st.dataset.ref }); return; }
      const cm = e.target.closest('.commit-row');
      if (cm && e.target.closest('.chevron')) { vscode.postMessage({ type: 'toggleCommit', hash: cm.dataset.hash, section: cm.dataset.section || 'history' }); return; }
    });

    // 체크박스 토글 (변경 파일 선택)
    lists.addEventListener('change', (e) => {
      if (!e.target.classList || !e.target.classList.contains('cb')) return;
      const row = e.target.closest('.chfile[data-kind="changedFile"]');
      if (row) vscode.postMessage({ type: 'toggleFile', path: row.dataset.path, checked: e.target.checked });
    });

    // 우클릭 메뉴 (커밋/브랜치/섹션) — 항목 종류(contextValue)별 메뉴.
    // 문서 전역에서 처리: 입력창은 네이티브 메뉴 허용, 그 외에는 네이티브 차단 + 커스텀 메뉴.
    document.addEventListener('contextmenu', (e) => {
      hideMenu(); // 기존 메뉴 먼저 닫기 (중복 열림 방지)
      if (e.target.closest('#inputarea')) return; // 입력창: 네이티브 메뉴(붙여넣기 등) 허용
      e.preventDefault();                          // 그 외: 네이티브 메뉴 차단
      const target = e.target.closest('[data-kind="commit"], [data-kind="branch"], [data-kind="section"],'
        + ' [data-kind="file"], [data-kind="changedFile"], [data-kind="stash"], [data-kind="stashFile"]');
      if (!target || !target.dataset.ctx) return;
      const items = MENU[target.dataset.ctx];
      if (items && items.length) showMenu(e.clientX, e.clientY, items, target.dataset);
    });

    function showMenu(x, y, items, data) {
      menu.innerHTML = '';
      for (const it of items) {
        const d = document.createElement('div');
        d.className = it.disabled ? 'mi disabled' : 'mi';
        d.textContent = it.label;
        if (!it.disabled) {
          d.addEventListener('click', (ev) => {
            ev.stopPropagation(); hideMenu();
            vscode.postMessage({ type: 'command', command: it.command,
              arg: { kind: data.kind, hash: data.hash, branch: data.branch, file: data.file,
                     path: data.path, ref: data.ref, ctx: data.ctx, unfetched: data.unfetched === '1' } });
          });
        }
        menu.appendChild(d);
      }
      // 먼저 보이게 한 뒤 크기를 재서 화면 경계로 위치 보정 (아래/오른쪽 공간 없으면 뒤집기)
      menu.style.left = '0'; menu.style.top = '0'; menu.style.display = 'block';
      const r = menu.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = x, top = y;
      if (left + r.width > vw) left = x - r.width;        // 오른쪽 넘으면 왼쪽으로
      left = Math.max(0, Math.min(left, vw - r.width));   // 화면 안으로 당김
      if (top + r.height > vh) top = y - r.height;         // 아래 공간 없으면 위로
      top = Math.max(0, Math.min(top, vh - r.height));     // 화면 안으로 당김
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
    }

    // 키보드 탐색 (M5): 위/아래 이동, Enter=동작/메뉴, 좌/우=접기/펼치기
    lists.addEventListener('keydown', (e) => {
      const rows = [...lists.querySelectorAll(
        '.section-header, .branch-row, .commit-row, .chfile, .chdir, .stash-row')];
      if (!rows.length) return;
      let idx = rows.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1); rows[idx].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = idx <= 0 ? 0 : idx - 1; rows[idx].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') {
        if (idx < 0) return;
        e.preventDefault();
        const el = rows[idx];
        if (el.classList.contains('commit-row')) {
          vscode.postMessage({ type: 'toggleCommit', hash: el.dataset.hash, section: el.dataset.section || 'history' });
        } else {
          // 체크박스가 있는 행(변경 파일/전체 선택)은 체크 토글
          const cb = el.querySelector('input.cb');
          if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); }
          else { el.click(); }
        }
      } else if (e.key === 'ContextMenu') {
        if (idx < 0) return;
        const el = rows[idx];
        if (el.dataset.ctx && MENU[el.dataset.ctx]) {
          e.preventDefault();
          const r = el.getBoundingClientRect();
          showMenu(r.left + 12, r.bottom, MENU[el.dataset.ctx] || [], el.dataset);
        }
      } else if (e.key === 'ArrowRight') {
        if (idx >= 0 && rows[idx].getAttribute('aria-expanded') === 'false') { e.preventDefault(); rows[idx].click(); }
      } else if (e.key === 'ArrowLeft') {
        if (idx >= 0 && rows[idx].getAttribute('aria-expanded') === 'true') { e.preventDefault(); rows[idx].click(); }
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

module.exports = {
  renderLists,
  renderShell,
  renderCommitRow,
  renderCommitTable,
  renderChanges,
  renderStash,
  fieldValue,
  esc,
};
