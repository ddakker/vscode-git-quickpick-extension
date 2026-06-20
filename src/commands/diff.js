'use strict';

// diff/복사 명령 — 해시·메시지 복사, 커밋/파일 diff 열기.

const vscode = require('vscode');
const path = require('path');
const { t } = require('../i18n');
const { execGit } = require('../git/exec');
const { getWorkspaceCwd } = require('../workspace');

async function copyShortHash(hash) {
  const shortHash = hash.substring(0, 8);
  await vscode.env.clipboard.writeText(shortHash);
  vscode.window.showInformationMessage(t('hashCopied', shortHash));
}

async function copyHash(item) {
  await copyShortHash(item.commitHash);
}

async function copyCommitMessage(itemOrHash) {
  const cwd = getWorkspaceCwd();
  if (!cwd) return;
  const hash = typeof itemOrHash === 'string' ? itemOrHash : itemOrHash && itemOrHash.commitHash;
  if (!hash) return;
  try {
    const { stdout } = await execGit(['show', '-s', '--format=%B', hash], cwd);
    await vscode.env.clipboard.writeText(stdout.replace(/\s+$/, ''));
    vscode.window.showInformationMessage(t('messageCopied'));
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

// 커밋 시점의 파일 내용을 읽기 전용으로 연다 (diff 아님)
async function openCommitFileContent(hash, filePath, cwd) {
  if (!cwd) return;
  try {
    const uri = vscode.Uri.parse(
      `gitreflow://show/${hash}/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    await vscode.window.showTextDocument(uri, { preview: true });
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function openCommitFileDiff(hash, filePath, cwd) {
  try {
    const parentRef = `${hash}~1`;
    const beforeUri = vscode.Uri.parse(
      `gitreflow://show/${parentRef}/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const afterUri = vscode.Uri.parse(
      `gitreflow://show/${hash}/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const title = `${filePath} (${hash.substring(0, 8)})`;
    await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, title);
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function openCommitFileVsLocal(hash, filePath, cwd) {
  try {
    const commitUri = vscode.Uri.parse(
      `gitreflow://show/${hash}/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const workingUri = vscode.Uri.file(path.join(cwd, filePath));
    const title = `${filePath} (${hash.substring(0, 8)} ↔ ${t('local')})`;
    await vscode.commands.executeCommand('vscode.diff', commitUri, workingUri, title);
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function openDeletedFileDiff(filePath) {
  const cwd = getWorkspaceCwd();
  if (!cwd) return;
  try {
    const headUri = vscode.Uri.parse(
      `gitreflow://show/HEAD/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const emptyUri = vscode.Uri.parse(
      `gitreflow://empty/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const title = `${filePath} (Deleted)`;
    await vscode.commands.executeCommand('vscode.diff', headUri, emptyUri, title);
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

async function openFileDiff(fileUri) {
  const cwd = getWorkspaceCwd();
  if (!cwd) return;

  const filePath = vscode.workspace.asRelativePath(fileUri, false);
  try {
    const { stdout } = await execGit(
      ['log', '-1', '--format=%H', '--', filePath], cwd
    );
    const hash = stdout.trim();
    if (!hash) {
      await vscode.commands.executeCommand('vscode.open', fileUri);
      return;
    }

    const commitUri = vscode.Uri.parse(
      `gitreflow://show/${hash}/${filePath}?cwd=${encodeURIComponent(cwd)}`
    );
    const title = `${filePath} (${hash.substring(0, 8)} vs Working)`;
    await vscode.commands.executeCommand('vscode.diff', commitUri, fileUri, title);
  } catch {
    await vscode.commands.executeCommand('git.openChange', fileUri);
  }
}

async function viewDiff(item) {
  const cwd = getWorkspaceCwd();
  if (!cwd) return;

  const hash = item.commitHash;
  try {
    const { stdout } = await execGit(
      ['diff-tree', '--no-commit-id', '-r', '--name-only', hash], cwd
    );
    const files = stdout.trim().split('\n').filter(Boolean);
    if (files.length === 0) {
      vscode.window.showInformationMessage(t('noDiffFiles'));
      return;
    }

    const fileItems = files.map(f => ({ label: f }));
    const selectedFile = await vscode.window.showQuickPick(fileItems, {
      placeHolder: t('selectFile'),
    });
    if (!selectedFile) return;

    const commitUri = vscode.Uri.parse(
      `gitreflow://show/${hash}/${selectedFile.label}?cwd=${encodeURIComponent(cwd)}`
    );
    const workingUri = vscode.Uri.file(path.join(cwd, selectedFile.label));
    const title = `${selectedFile.label} (${hash.substring(0, 8)} vs Working)`;
    await vscode.commands.executeCommand('vscode.diff', commitUri, workingUri, title);
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    vscode.window.showErrorMessage(t('failed', msg.trim()));
  }
}

module.exports = {
  copyShortHash, copyHash, copyCommitMessage, openCommitFileContent, openCommitFileDiff,
  openCommitFileVsLocal, openDeletedFileDiff, openFileDiff, viewDiff,
};
