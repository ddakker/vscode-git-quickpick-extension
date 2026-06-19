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

// 커밋 한 행을 <tr> 로 렌더. fieldOrder 순서대로 셀, fieldStyles 로 bright/dim class.
function renderCommitRow(commit, ctx, config) {
  const cells = config.fieldOrder.map(f => {
    const style = config.fieldStyles[f] === 'bright' ? 'bright' : 'dim';
    const isMsg = f === 'message';
    const w = config.fieldWidths[f];
    const cls = `cell ${style}${isMsg ? ' msg' : ' meta'}`;
    const styleAttr = !isMsg && w ? ` style="max-width:${Number(w)}px"` : '';
    return `<td class="${cls}"${styleAttr}>${esc(fieldValue(commit, f))}</td>`;
  }).join('');
  return `<tr class="commit-row" role="row" tabindex="-1"`
    + ` data-kind="commit" data-hash="${esc(commit.hash)}" data-ctx="${esc(ctx)}"`
    + ` title="${esc(commitTooltip(commit))}">${cells}</tr>`;
}

function commitTooltip(c) {
  return `${c.date || ''} · ${c.author || ''} · ${(c.hash || '').substring(0, 8)}\n${c.message || ''}`;
}

// 커밋 테이블 (히스토리/브랜치 히스토리 공통)
function renderCommitTable(commits, ctx, config, labels) {
  if (!commits) return `<div class="loading">${esc(labels.loading)}</div>`;
  if (commits.length === 0) return `<div class="empty">${esc(labels.noCommits)}</div>`;
  const rows = commits.map(c => renderCommitRow(c, ctx, config)).join('');
  return `<table class="commits" role="table"><tbody>${rows}</tbody></table>`;
}

function sectionHeader(section, label, expanded) {
  const chevron = expanded ? '▾' : '▸';
  return `<div class="section-header" role="button" tabindex="0"`
    + ` data-kind="section" data-section="${esc(section)}" aria-expanded="${expanded ? 'true' : 'false'}">`
    + `<span class="chevron">${chevron}</span><span class="section-title">${esc(label)}</span></div>`;
}

function renderBranchRow(branch, isRemote, config, labels, branchHistory, expanded) {
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
    sub = `<div class="branch-history">${renderCommitTable(branchHistory[branch.name], 'branchHistoryCommit', config, labels)}</div>`;
  }
  return header + sub;
}

// 리스트 영역 전체 HTML (#lists 안에 들어갈 내용). 서버사이드 렌더 → 테스트 가능.
function renderLists(state, labels) {
  const config = state.config;
  const exp = state.expanded || {};
  const parts = [];

  // 진행 중 배너
  if (state.inProgress) {
    const opLabel = labels.inProgress[state.inProgress] || state.inProgress;
    parts.push(
      `<div class="banner" role="alert">`
      + `<span class="banner-text">${esc(opLabel)}</span>`
      + `<button class="banner-btn continue" data-kind="op" data-op="continue">${esc(labels.continue)}</button>`
      + `<button class="banner-btn abort" data-kind="op" data-op="abort">${esc(labels.abort)}</button>`
      + `</div>`
    );
  }

  // 히스토리 섹션
  parts.push(`<div class="section">`);
  parts.push(sectionHeader('history', labels.sectionHistory, !!exp.history));
  if (exp.history) {
    parts.push(`<div class="section-body">${renderCommitTable(state.history, 'historyCommit', config, labels)}</div>`);
  }
  parts.push(`</div>`);

  // 로컬 브랜치 섹션
  parts.push(`<div class="section">`);
  parts.push(sectionHeader('localBranch', labels.sectionLocalBranch, !!exp.localBranch));
  if (exp.localBranch) {
    const rows = (state.localBranches || []).map(b =>
      renderBranchRow(b, false, config, labels, state.branchHistory || {}, exp)).join('');
    parts.push(`<div class="section-body">${rows || `<div class="empty">${esc(labels.noBranches)}</div>`}</div>`);
  }
  parts.push(`</div>`);

  // 원격 브랜치 섹션
  parts.push(`<div class="section">`);
  parts.push(sectionHeader('remoteBranch', labels.sectionRemoteBranch, !!exp.remoteBranch));
  if (exp.remoteBranch) {
    const rows = (state.remoteBranches || []).map(b =>
      renderBranchRow(b, true, config, labels, state.branchHistory || {}, exp)).join('');
    parts.push(`<div class="section-body">${rows || `<div class="empty">${esc(labels.noBranches)}</div>`}</div>`);
  }
  parts.push(`</div>`);

  return parts.join('\n');
}

// 페이지 골격 — CSS + 빈 컨테이너 + 클라이언트 JS (innerHTML 교체 + 클릭/메뉴/툴바).
function renderShell({ nonce, cspSource, labels, menu }) {
  const csp = `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; `
    + `script-src 'nonce-${nonce}'; img-src ${cspSource} data:;`;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px);
         color: var(--vscode-foreground); }
  .toolbar { display: flex; gap: 2px; padding: 4px; position: sticky; top: 0;
             background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); z-index: 2; }
  .toolbar button { background: transparent; border: none; color: var(--vscode-foreground); cursor: pointer;
                    padding: 3px 6px; border-radius: 3px; font-size: 12px; }
  .toolbar button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .section-header, .branch-row, .commit-row { cursor: pointer; }
  .section-header { display: flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px; font-weight: 600;
                    user-select: none; }
  .section-header:hover, .branch-row:hover { background: var(--vscode-list-hoverBackground); }
  .chevron { display: inline-block; width: 12px; color: var(--vscode-descriptionForeground); }
  .section-body { }
  table.commits { width: 100%; border-collapse: collapse; table-layout: auto; }
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
  .branch-row { display: flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px; }
  .bicon { width: 14px; color: var(--vscode-descriptionForeground); text-align: center; }
  .bname { flex-shrink: 0; }
  .current { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-charts-blue)); font-size: 11px; }
  .bdesc { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .branch-history { padding-left: 14px; }
  .empty, .loading { padding: 4px 12px; color: var(--vscode-descriptionForeground); font-style: italic; }
  .banner { display: flex; align-items: center; gap: 6px; padding: 6px 8px; margin: 4px;
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
</style>
</head>
<body>
  <div class="toolbar">
    <button data-cmd="gitReflow.refreshView" title="${esc(labels.tbRefresh)}">⟳</button>
    <button data-cmd="gitReflow.createBranch" title="${esc(labels.tbNewBranch)}">＋</button>
    <button data-cmd="gitReflow.execPush" title="${esc(labels.tbPush)}">↑</button>
    <button data-cmd="gitReflow.execPull" title="${esc(labels.tbPull)}">↓</button>
    <button data-cmd="gitReflow.execForcePull" title="${esc(labels.tbForcePull)}">⤓</button>
    <button data-cmd="gitReflow.createStash" title="${esc(labels.tbStash)}">⤵</button>
    <button data-cmd="gitReflow.cleanupBackups" title="${esc(labels.tbCleanup)}">🧹</button>
    <button data-cmd="gitReflow.openSettings" title="${esc(labels.tbSettings)}">⚙</button>
  </div>
  <div id="lists"></div>
  <div id="ctxmenu"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const lists = document.getElementById('lists');
    const menu = document.getElementById('ctxmenu');

    // 커밋/브랜치 우클릭 메뉴 정의 (라벨은 ext 에서 주입)
    const MENU = ${JSON.stringify(menu || { commit: [], branch: [] })};

    window.addEventListener('message', (e) => {
      const m = e.data;
      if (m.type === 'render') { lists.innerHTML = m.listsHtml; }
    });

    function hideMenu() { menu.style.display = 'none'; }
    document.addEventListener('click', hideMenu);
    document.addEventListener('scroll', hideMenu, true);

    // 툴바
    document.querySelector('.toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cmd]');
      if (btn) vscode.postMessage({ type: 'command', command: btn.dataset.cmd });
    });

    // 리스트 클릭: 섹션/브랜치 토글, 배너 op
    lists.addEventListener('click', (e) => {
      const op = e.target.closest('[data-kind="op"]');
      if (op) { vscode.postMessage({ type: 'op', op: op.dataset.op }); return; }
      const sec = e.target.closest('[data-kind="section"]');
      if (sec) { vscode.postMessage({ type: 'toggleSection', section: sec.dataset.section }); return; }
      const br = e.target.closest('[data-kind="branch"]');
      if (br) { vscode.postMessage({ type: 'toggleBranch', branchName: br.dataset.branch }); return; }
    });

    // 우클릭 메뉴 (커밋/브랜치)
    lists.addEventListener('contextmenu', (e) => {
      const commit = e.target.closest('[data-kind="commit"]');
      const branch = e.target.closest('[data-kind="branch"]');
      const target = commit || branch;
      if (!target) return;
      e.preventDefault();
      const kind = commit ? 'commit' : 'branch';
      const items = MENU[kind] || [];
      showMenu(e.clientX, e.clientY, items, target.dataset);
    });

    function showMenu(x, y, items, data) {
      menu.innerHTML = '';
      for (const it of items) {
        const d = document.createElement('div');
        d.className = 'mi';
        d.textContent = it.label;
        d.addEventListener('click', (ev) => {
          ev.stopPropagation(); hideMenu();
          vscode.postMessage({ type: 'command', command: it.command, arg: { kind: data.kind, hash: data.hash, branch: data.branch, ctx: data.ctx, unfetched: data.unfetched === '1' } });
        });
        menu.appendChild(d);
      }
      menu.style.left = x + 'px'; menu.style.top = y + 'px'; menu.style.display = 'block';
    }

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
  fieldValue,
  esc,
};
