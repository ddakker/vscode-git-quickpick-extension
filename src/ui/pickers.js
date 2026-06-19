'use strict';

// QuickPick UI 헬퍼 — 명령 팔레트 하위호환용 브랜치/액션/커밋 선택 다이얼로그.

const vscode = require('vscode');
const { t } = require('../i18n');
const { getCommitLog } = require('../git/queries');

async function showBranchPicker(branches, currentBranch) {
  const items = branches.map(({ name, description }) => ({
    label: name,
    description: name === currentBranch
      ? `${t('current')} ${description}`
      : description,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `${t('selectBranch')} (${t('currentBranch', currentBranch)})`,
  });
  return selected ? selected.label : undefined;
}

async function showActionPicker(branchName) {
  const items = [
    { label: `$(git-merge) ${t('rebaseOnto', branchName)}`, value: 'rebase' },
    { label: `$(git-pull-request) ${t('merge', branchName)}`, value: 'merge' },
  ];
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: t('selectAction'),
  });
  return selected ? selected.value : undefined;
}

async function showPullActionPicker() {
  const items = [
    { label: `$(cloud-download) ${t('pull')}`, value: 'pull' },
    { label: `$(git-merge) ${t('pullRebase')}`, value: 'pull-rebase' },
  ];
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: t('selectAction'),
  });
  return selected ? selected.value : undefined;
}

async function showCommitPicker(cwd, options = {}) {
  const { branch, count = 30, title } = options;
  const commits = await getCommitLog(cwd, { branch, count });
  if (commits.length === 0) {
    vscode.window.showInformationMessage(t('noCommits'));
    return undefined;
  }
  const items = commits.map(c => ({
    label: `${c.hash.substring(0, 8)} ${c.message}`,
    description: `${c.author}  ${c.date}`,
    hash: c.hash,
    message: c.message,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: title || t('selectCommit'),
  });
  return selected ? { hash: selected.hash, message: selected.message } : undefined;
}

module.exports = { showBranchPicker, showActionPicker, showPullActionPicker, showCommitPicker };
