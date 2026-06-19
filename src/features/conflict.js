'use strict';

// 충돌 처리 — 충돌 파일 조회/스테이지, modify-delete 해결, 충돌 마커/머지 에디터 열기.

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { execGit, execGitSilent } = require('../git/exec');
const { t } = require('../i18n');
const { getWorkspaceCwd } = require('../workspace');
const runtime = require('../runtime');

async function getConflictedFiles(cwd) {
  // git ls-files -u: 인덱스의 unmerged stage(1/2/3) 항목을 직접 조회.
  // modify/delete 포함 모든 충돌 유형을 놓치지 않고 잡는다.
  try {
    const { stdout } = await execGitSilent(['ls-files', '-u'], cwd);
    const files = new Set();
    for (const line of stdout.split('\n')) {
      // 형식: <mode> <hash> <stage>\t<path>
      const m = line.match(/^\S+\s+\S+\s+[123]\t(.+)$/);
      if (m) files.add(m[1]);
    }
    return Array.from(files);
  } catch {
    return [];
  }
}

// 파일의 충돌 stage 집합 조회 (1=base, 2=ours, 3=theirs)
async function getConflictStages(cwd, file) {
  const stages = new Set();
  try {
    const { stdout } = await execGitSilent(['ls-files', '-u', '--', file], cwd);
    for (const line of stdout.split('\n')) {
      // 형식: <mode> <hash> <stage>\t<path>
      const m = line.match(/^\S+\s+\S+\s+([123])\s/);
      if (m) stages.add(m[1]);
    }
  } catch { /* no conflict info */ }
  return stages;
}

// modify/delete 충돌: 한 쪽에서 파일이 삭제되고 다른 쪽에서 수정된 경우
async function resolveModifyDeleteConflict(cwd, file, stages) {
  const deletedByOurs = !stages.has('2');   // ours(HEAD)에서 삭제
  const deletedByTheirs = !stages.has('3'); // theirs(incoming)에서 삭제

  const detail = deletedByTheirs ? t('deletedByIncoming')
    : deletedByOurs ? t('deletedByCurrent')
    : '';

  const keepDeletion = t('keepDeletion');
  const keepFile = t('keepFile');
  const openFile = t('openFileToReview');

  const choice = await vscode.window.showWarningMessage(
    t('modifyDeleteTitle', file),
    { modal: true, detail },
    keepDeletion,
    keepFile,
    openFile
  );

  if (choice === keepDeletion) {
    await execGit(['rm', '-f', '--', file], cwd);
    vscode.window.showInformationMessage(t('modifyDeleteResolvedDeleted', file));
  } else if (choice === keepFile) {
    // 작업 트리에 파일이 없으면 살아있는 stage(2 또는 3) 내용을 복원
    const filePath = path.join(cwd, file);
    if (!fs.existsSync(filePath)) {
      const aliveStage = stages.has('2') ? '2' : stages.has('3') ? '3' : null;
      if (aliveStage) {
        const { stdout } = await execGitSilent(['show', `:${aliveStage}:${file}`], cwd);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, stdout);
      }
    }
    await execGit(['add', '--', file], cwd);
    vscode.window.showInformationMessage(t('modifyDeleteResolvedKept', file));
  } else if (choice === openFile) {
    const filePath = path.join(cwd, file);
    if (fs.existsSync(filePath)) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
    }
  }
}

// 같은 파일을 가리키는 특정 종류의 탭을 모두 닫는다.
//  kind 'text'  : 일반 텍스트 에디터(TabInputText)        — uri 일치
//  kind 'merge' : 3-way 머지 에디터(TabInputTextMerge)    — result(워킹트리 파일) 일치
// 마커 에디터와 머지 에디터가 같은 파일에 동시에 열리는 것을 막는다.
async function closeEditorsForFile(uri, kind) {
  const target = uri.toString();
  const toClose = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      const isText = kind === 'text'
        && vscode.TabInputText && input instanceof vscode.TabInputText
        && input.uri.toString() === target;
      const isMerge = kind === 'merge'
        && vscode.TabInputTextMerge && input instanceof vscode.TabInputTextMerge
        && input.result.toString() === target;
      if (isText || isMerge) toClose.push(tab);
    }
  }
  if (toClose.length) {
    try { await vscode.window.tabGroups.close(toClose); } catch { /* 사용자가 닫기 취소 등 — 무시 */ }
  }
}

// 워킹트리의 상대경로 파일을 일반 에디터로 연다.
// 삭제됐거나 워킹트리에 없는 파일은 안내만 한다(조용한 실패 방지).
function openWorkingFile(relativePath) {
  const cwd = getWorkspaceCwd();
  if (!cwd || !relativePath) return;
  const absPath = path.join(cwd, relativePath);
  if (!fs.existsSync(absPath)) {
    vscode.window.showInformationMessage(t('fileNotInWorkspace', relativePath));
    return;
  }
  vscode.window.showTextDocument(vscode.Uri.file(absPath), { preview: false });
}

// 충돌 파일을 충돌 마커(<<<<<<< ======= >>>>>>>)가 보이는 텍스트 에디터로 연다.
// VS Code 머지 에디터를 한 번 열면 워킹트리 파일에서 마커가 사라질 수 있으므로,
// 마커가 없고 아직 unmerged 상태면 git checkout --merge 로 마커를 재생성한 뒤 연다.
async function openConflictFileWithMarkers(cwd, file) {
  if (!cwd || !file) return;
  const abs = path.join(cwd, file);
  if (!fs.existsSync(abs)) {
    vscode.window.showInformationMessage(t('fileNotInWorkspace', file));
    return;
  }

  let hasMarkers = false;
  try { hasMarkers = fs.readFileSync(abs, 'utf8').includes('<<<<<<<'); } catch { /* 바이너리 등 */ }

  let regenerated = false;
  if (!hasMarkers) {
    // 인덱스에 unmerged stage(1/2/3)가 남아 있을 때만 마커 재생성이 가능하다.
    const stages = await getConflictStages(cwd, file);
    if (stages.size > 0) {
      // checkout --merge 는 워킹트리 파일을 원래 충돌 버전으로 덮어쓴다.
      // 머지 에디터에서 이미 해결한 내용이 있을 수 있으므로, 덮어쓰기 전에 확인한다.
      const restore = t('conflictRestore');
      const openAsIs = t('conflictOpenAsIs');
      const choice = await vscode.window.showWarningMessage(
        t('conflictRestoreTitle', file),
        { modal: true, detail: t('conflictRestoreDetail') },
        restore,
        openAsIs
      );
      if (choice === undefined) return; // 취소 — 아무것도 열지 않는다.
      if (choice === restore) {
        try {
          await execGit(['checkout', '--merge', '--', file], cwd);
          regenerated = true;
        } catch (err) {
          runtime.getOutputChannel().appendLine(
            `[WARN] checkout --merge failed for ${file}: ${err.message || err}`
          );
        }
      }
      // openAsIs 선택 시: 복원하지 않고 현재 워킹트리 내용 그대로 연다.
    }
  }

  const uri = vscode.Uri.file(abs);
  // 같은 파일의 머지 에디터가 열려 있으면 닫는다(동시 오픈 방지).
  await closeEditorsForFile(uri, 'merge');
  await vscode.window.showTextDocument(uri, { preview: false });
  // git 이 디스크를 다시 쓴 경우, 이미 열려 있던 문서가 옛 내용일 수 있어 디스크와 동기화
  if (regenerated) {
    try { await vscode.commands.executeCommand('workbench.action.files.revert'); }
    catch { /* 활성 에디터 없음 등 — 무시 */ }
  }
}

async function openMergeEditors(cwd, files) {
  for (const file of files) {
    const stages = await getConflictStages(cwd, file);
    // modify/delete 충돌: ours(2) 또는 theirs(3) 중 하나가 없음 → 머지 에디터 부적합
    const isModifyDelete = !stages.has('2') || !stages.has('3');
    if (isModifyDelete) {
      await resolveModifyDeleteConflict(cwd, file, stages);
      continue;
    }

    const resultUri = vscode.Uri.file(path.join(cwd, file));
    // 같은 파일의 일반 에디터가 열려 있으면 닫는다(동시 오픈 방지).
    await closeEditorsForFile(resultUri, 'text');
    try {
      // Git 확장의 공식 명령으로 3-way Merge Editor 열기.
      // 워킹트리의 충돌 파일 Uri만 넘기면 base/ours/theirs는 VS Code가 처리한다.
      await vscode.commands.executeCommand('git.openMergeEditor', resultUri);
    } catch (err) {
      // 머지 에디터를 못 열면 조용히 넘기지 말고 원인을 남기고 일반 에디터로 폴백
      runtime.getOutputChannel().appendLine(
        `[WARN] git.openMergeEditor failed for ${file}: ${err.message || err}`
      );
      await vscode.commands.executeCommand('vscode.open', resultUri);
    }
  }
}

module.exports = {
  getConflictedFiles,
  getConflictStages,
  resolveModifyDeleteConflict,
  closeEditorsForFile,
  openWorkingFile,
  openConflictFileWithMarkers,
  openMergeEditors,
};
