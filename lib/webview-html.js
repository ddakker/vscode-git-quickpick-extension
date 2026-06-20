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
function renderCommitRow(commit, ctx, config, expanded) {
  const chevron = `<span class="chevron">${expanded ? '▾' : '▸'}</span>`;
  const cells = config.fieldOrder.map((f, i) => {
    const style = config.fieldStyles[f] === 'bright' ? 'bright' : 'dim';
    const isMsg = f === 'message';
    const w = config.fieldWidths[f];
    const cls = `cell ${style}${isMsg ? ' msg' : ' meta'}`;
    const styleAttr = !isMsg && w ? ` style="max-width:${Number(w)}px"` : '';
    const prefix = i === 0 ? chevron : '';
    return `<td class="${cls}"${styleAttr}>${prefix}${esc(fieldValue(commit, f))}</td>`;
  }).join('');
  return `<tr class="commit-row" role="row" tabindex="-1"`
    + ` data-kind="commit" data-hash="${esc(commit.hash)}" data-ctx="${esc(ctx)}"`
    + ` aria-expanded="${expanded ? 'true' : 'false'}"`
    + ` title="${esc(commitTooltip(commit))}">${cells}</tr>`;
}

// 펼친 커밋의 변경 파일 목록을 colspan 하위행으로 렌더
function renderCommitFiles(hash, files, colspan, labels) {
  const inner = (!files || files.length === 0)
    ? `<div class="empty">${esc(labels.noDiffFiles || '')}</div>`
    : files.map(f => {
      const letter = fileLetter(f.statusCode);
      return `<div class="cfile" data-kind="file" data-ctx="commitFile"`
        + ` data-hash="${esc(hash)}" data-file="${esc(f.filePath)}" title="${esc(f.filePath)}">`
        + `<span class="cfl cfl-${esc(letter)}">${esc(letter)}</span>`
        + `<span class="cfp">${esc(f.filePath)}</span></div>`;
    }).join('');
  return `<tr class="cfiles-row"><td class="cfiles" colspan="${colspan}">${inner}</td></tr>`;
}

function commitTooltip(c) {
  return `${c.date || ''} · ${c.author || ''} · ${(c.hash || '').substring(0, 8)}\n${c.message || ''}`;
}

// 커밋 테이블 (히스토리/브랜치 히스토리 공통). commitFiles 에 있는 해시는 펼쳐서 파일 표시.
function renderCommitTable(commits, ctx, config, labels, commitFiles = {}) {
  if (!commits) return `<div class="loading">${esc(labels.loading)}</div>`;
  if (commits.length === 0) return `<div class="empty">${esc(labels.noCommits)}</div>`;
  const colspan = config.fieldOrder.length;
  const rows = commits.map((c, i) => {
    // 히스토리의 최신(첫) 커밋은 historyCommitLatest (amend 메뉴 추가용 — master 동일)
    const rowCtx = (ctx === 'historyCommit' && i === 0) ? 'historyCommitLatest' : ctx;
    const isExp = Object.prototype.hasOwnProperty.call(commitFiles, c.hash);
    const row = renderCommitRow(c, rowCtx, config, isExp);
    return isExp ? row + renderCommitFiles(c.hash, commitFiles[c.hash], colspan, labels) : row;
  }).join('');
  return `<table class="commits" role="table"><tbody>${rows}</tbody></table>`;
}

function sectionHeader(section, label, expanded) {
  const chevron = expanded ? '▾' : '▸';
  // 로컬 브랜치 섹션 헤더는 우클릭 메뉴(브랜치 생성)를 가짐 — master 동일
  const ctxAttr = section === 'localBranch' ? ' data-ctx="localBranchSection"' : '';
  return `<div class="section-header" role="button" tabindex="0"`
    + ` data-kind="section" data-section="${esc(section)}"${ctxAttr} aria-expanded="${expanded ? 'true' : 'false'}">`
    + `<span class="chevron">${chevron}</span><span class="section-title">${esc(label)}</span></div>`;
}

function renderBranchRow(branch, isRemote, config, labels, branchHistory, expanded, commitFiles) {
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
    sub = `<div class="branch-history">${renderCommitTable(branchHistory[branch.name], 'branchHistoryCommit', config, labels, commitFiles)}</div>`;
  }
  return header + sub;
}

// 리스트 영역 전체 HTML (#lists 안에 들어갈 내용). 서버사이드 렌더 → 테스트 가능.
function renderLists(state, labels) {
  const config = state.config;
  const exp = state.expanded || {};
  const cf = state.commitFiles || {};
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
    parts.push(`<div class="section-body">${renderCommitTable(state.history, 'historyCommit', config, labels, cf)}</div>`);
  }
  parts.push(`</div>`);

  // 로컬 브랜치 섹션
  parts.push(`<div class="section">`);
  parts.push(sectionHeader('localBranch', labels.sectionLocalBranch, !!exp.localBranch));
  if (exp.localBranch) {
    const rows = (state.localBranches || []).map(b =>
      renderBranchRow(b, false, config, labels, state.branchHistory || {}, exp, cf)).join('');
    parts.push(`<div class="section-body">${rows || `<div class="empty">${esc(labels.noBranches)}</div>`}</div>`);
  }
  parts.push(`</div>`);

  // 원격 브랜치 섹션
  parts.push(`<div class="section">`);
  parts.push(sectionHeader('remoteBranch', labels.sectionRemoteBranch, !!exp.remoteBranch));
  if (exp.remoteBranch) {
    const rows = (state.remoteBranches || []).map(b =>
      renderBranchRow(b, true, config, labels, state.branchHistory || {}, exp, cf)).join('');
    parts.push(`<div class="section-body">${rows || `<div class="empty">${esc(labels.noBranches)}</div>`}</div>`);
  }
  parts.push(`</div>`);

  return parts.join('\n');
}

// 페이지 골격 — CSS + 빈 컨테이너 + 클라이언트 JS (innerHTML 교체 + 클릭/메뉴/툴바).
function renderShell({ nonce, cspSource, labels, menu, inputPosition }) {
  const csp = `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; `
    + `script-src 'nonce-${nonce}'; img-src ${cspSource} data:;`;
  const pos = ['top', 'bottom', 'hidden'].includes(inputPosition) ? inputPosition : 'top';
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
  body.pos-hidden #inputarea { display: none; }
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
  .section-header, .branch-row, .commit-row { cursor: pointer; }
  .section-header { display: flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px; font-weight: 600;
                    user-select: none; }
  .section-header:hover, .branch-row:hover { background: var(--vscode-list-hoverBackground); }
  /* 펼친 하위 목록(커밋/브랜치)을 섹션 헤더 아래로 들여쓰기 (트리 중첩) */
  .section-body { padding-left: 12px; }
  .chevron { display: inline-block; width: 12px; color: var(--vscode-descriptionForeground); }
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
  td.cfiles { padding: 0 0 2px 0; }
  .cfile { display: flex; align-items: center; gap: 6px; height: 20px; padding: 0 6px 0 18px; cursor: pointer; }
  .cfile:hover { background: var(--vscode-list-hoverBackground); }
  .cfl { flex-shrink: 0; width: 12px; text-align: center; font-family: var(--vscode-editor-font-family, monospace);
         color: var(--vscode-descriptionForeground); }
  .cfl-A { color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-charts-green)); }
  .cfl-U { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-charts-blue)); }
  .cfl-D { color: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-charts-red)); }
  .cfp { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .branch-row { display: flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px; }
  .bicon { width: 14px; color: var(--vscode-descriptionForeground); text-align: center; }
  .bname { flex-shrink: 0; }
  .current { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-charts-blue)); font-size: 11px; }
  .bdesc { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .branch-history { padding-left: 12px; }
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
      else if (m.type === 'inputPosition') { document.body.className = 'pos-' + m.pos; }
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

    // 파일 더블클릭 → diff (커밋 변경)
    lists.addEventListener('dblclick', (e) => {
      const cf = e.target.closest('.cfile');
      if (cf) vscode.postMessage({ type: 'openCommitFile', hash: cf.dataset.hash, file: cf.dataset.file });
    });

    // 리스트 클릭: 커밋·섹션·브랜치 토글 / 배너 op
    lists.addEventListener('click', (e) => {
      const op = e.target.closest('[data-kind="op"]');
      if (op) { vscode.postMessage({ type: 'op', op: op.dataset.op }); return; }
      const sec = e.target.closest('[data-kind="section"]');
      if (sec) { vscode.postMessage({ type: 'toggleSection', section: sec.dataset.section }); return; }
      const br = e.target.closest('[data-kind="branch"]');
      if (br) { vscode.postMessage({ type: 'toggleBranch', branchName: br.dataset.branch }); return; }
      const cm = e.target.closest('.commit-row');
      if (cm) { vscode.postMessage({ type: 'toggleCommit', hash: cm.dataset.hash }); return; }
    });

    // 우클릭 메뉴 (커밋/브랜치/섹션) — 항목 종류(contextValue)별 메뉴.
    // 문서 전역에서 처리: 입력창은 네이티브 메뉴 허용, 그 외에는 네이티브 차단 + 커스텀 메뉴.
    document.addEventListener('contextmenu', (e) => {
      hideMenu(); // 기존 메뉴 먼저 닫기 (중복 열림 방지)
      if (e.target.closest('#inputarea')) return; // 입력창: 네이티브 메뉴(붙여넣기 등) 허용
      e.preventDefault();                          // 그 외: 네이티브 메뉴 차단
      const target = e.target.closest('[data-kind="commit"], [data-kind="branch"], [data-kind="section"], [data-kind="file"]');
      if (!target || !target.dataset.ctx) return;
      const items = MENU[target.dataset.ctx];
      if (items && items.length) showMenu(e.clientX, e.clientY, items, target.dataset);
    });

    function showMenu(x, y, items, data) {
      menu.innerHTML = '';
      for (const it of items) {
        const d = document.createElement('div');
        d.className = 'mi';
        d.textContent = it.label;
        d.addEventListener('click', (ev) => {
          ev.stopPropagation(); hideMenu();
          vscode.postMessage({ type: 'command', command: it.command,
            arg: { kind: data.kind, hash: data.hash, branch: data.branch, file: data.file, ctx: data.ctx, unfetched: data.unfetched === '1' } });
        });
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
      const rows = [...lists.querySelectorAll('.section-header, .branch-row, .commit-row')];
      if (!rows.length) return;
      let idx = rows.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1); rows[idx].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = idx <= 0 ? 0 : idx - 1; rows[idx].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') {
        if (idx < 0) return;
        e.preventDefault();
        const el = rows[idx];
        if (el.classList.contains('commit-row')) {
          vscode.postMessage({ type: 'toggleCommit', hash: el.dataset.hash });
        } else { el.click(); }
      } else if (e.key === 'ContextMenu') {
        if (idx < 0) return;
        const el = rows[idx];
        if (el.dataset.kind === 'commit' || el.dataset.kind === 'branch') {
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
  fieldValue,
  esc,
};
