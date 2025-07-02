import * as vscode from 'vscode';

/**
 * Shows a diff preview with decorations and a modal dialog for accepting or discarding the merge.
 * Expands the selection to whole lines, and if the selection ends at the beginning of a line,
 * it is treated as ending at the end of the previous line.
 */
export async function showDiffPreview(
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

  // Expand selection to whole lines if not already, and handle end at start of line
  const document = editor.document;
  let startLine = selection.start.line;
  let endLine = selection.end.line;
  let endChar = document.lineAt(endLine).text.length;

  // If selection ends at the beginning of a line, treat as ending at the end of the previous line
  if (selection.end.character === 0 && endLine > startLine) {
    endLine = endLine - 1;
    endChar = document.lineAt(endLine).text.length;
  }

  const expandedSelection = new vscode.Selection(
    new vscode.Position(startLine, 0),
    new vscode.Position(endLine, endChar)
  );

  try {
    // Construct expanded preview for green block
    const expandedStart = new vscode.Position(startLine, 0);
    const expandedEnd = new vscode.Position(endLine, endChar);
    const before = document.getText(new vscode.Range(expandedStart, selection.start));
    const after = document.getText(new vscode.Range(selection.end, expandedEnd));
    const expandedPreview = before + mergedCode + after;
    const previewLines = expandedPreview.split('\n');
    const previewPos = new vscode.Position(expandedSelection.end.line + 1, 0);
    const previewRange = new vscode.Range(
      previewPos,
      new vscode.Position(
        previewPos.line + previewLines.length - 1,
        previewLines[previewLines.length - 1].length
      )
    );
    const previewDeleteRange = new vscode.Range(
      previewPos,
      new vscode.Position(previewPos.line + previewLines.length, 0)
    );

    // Insert the preview temporarily
    await editor.edit(editBuilder => {
      editBuilder.insert(previewPos, expandedPreview + '\n');
    }, { undoStopBefore: false, undoStopAfter: false });

    // Apply the decorations
    editor.setDecorations(oldCodeDecoration, [expandedSelection]);
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
      editBuilder.delete(previewDeleteRange);
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
