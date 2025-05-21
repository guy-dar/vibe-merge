import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { handleCodeMerge } from './lm';

const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({path: envPath});


async function showDiffPreview(
  editor: vscode.TextEditor,
  selection: vscode.Selection,
  mergedCode: string
): Promise<void> {
  const oldCodeDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
    isWholeLine: true
  });

  const newCodeDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
    isWholeLine: true
  });

  try {
    const previewPos = new vscode.Position(selection.end.line + 1, 0);
    const previewRange = new vscode.Range(
      previewPos,
      previewPos.translate(mergedCode.split('\n').length)
    );

    // Insert the preview temporarily
    await editor.edit(editBuilder => {
      editBuilder.insert(previewPos, mergedCode + '\n');
    }, { undoStopBefore: false, undoStopAfter: false });

    // Apply the decorations
    editor.setDecorations(oldCodeDecoration, [selection]);
    editor.setDecorations(newCodeDecoration, [previewRange]);

    // Show modal dialog
    const result = await vscode.window.showQuickPick(
      ['Accept', 'Discard'],
      {
        placeHolder: 'Apply Vibe Merge?',
        ignoreFocusOut: true
      }
    );

    // Cleanup the preview regardless of choice
    await editor.edit(editBuilder => {
      editBuilder.delete(previewRange);
    }, { undoStopBefore: false, undoStopAfter: false });

    if (result === 'Accept') {
      // Apply the merged code in a single edit
      await editor.edit(editBuilder => {
        editBuilder.replace(selection, mergedCode);
      });
      vscode.window.showInformationMessage('Merged code applied!');
    }
  } finally {
    // Clean up decorations
    oldCodeDecoration.dispose();
    newCodeDecoration.dispose();
  }
}

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