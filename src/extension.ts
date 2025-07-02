import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { handleCodeMerge } from './lm';
import { showDiffPreview } from './ui/diff';

const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({path: envPath});


function getContextCode(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  contextLines: number
): { contextCode: string; startLine: number } {
  let contextCode = "";
  let startLine = 0;

  if (selection.start.line > 0 || selection.end.line < document.lineCount - 1) {
    startLine = Math.max(0, selection.start.line - contextLines);
    const endLine = Math.min(document.lineCount - 1, selection.end.line + contextLines);

    const contextRange = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, document.lineAt(endLine).text.length)
    );

    contextCode = document.getText(contextRange);
  }

  return { contextCode, startLine };
}

export function activate(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand('vibemerge.mergeClipboard', async () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage('No active editor');
      return;
    }

    const document = editor.document;
    const selection = editor.selection;
    const currentCode = document.getText(selection);
    const clipboardCode = await vscode.env.clipboard.readText();

    // Get some context around the selected code
    const contextLines = 10;
    const { contextCode, startLine } = getContextCode(document, selection, contextLines);

    const selectionOffset = document.offsetAt(selection.start) - document.offsetAt(new vscode.Position(startLine, 0));
    const mergedCode = await handleCodeMerge(currentCode, clipboardCode, contextCode, selectionOffset);
    if (!mergedCode) {
      vscode.window.showErrorMessage('Failed to merge code');
      return;
    }

    await showDiffPreview(editor, selection, mergedCode);
  });

  context.subscriptions.push(command);
}

export function deactivate() {}