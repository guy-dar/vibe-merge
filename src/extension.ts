import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import * as path from 'path';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import fetch from 'node-fetch';


const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({path: envPath});

const lmProvider = process.env.LM_PROVIDER || 'openrouter';

class VibeMergeProvider implements vscode.TextDocumentContentProvider {
  constructor(private contents: { [key: string]: string }) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents[uri.path.slice(1)];
  }
}

async function runLM(prompt: string): Promise<string | null> {
  let modelName = "";
  if (lmProvider === "OLLAMA") {
    modelName = process.env.OLLAMA_MODEL || 'null';
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        stream: false,
        messages: [
          { role: 'user', content: prompt},
        ]
      }),
    });
    const data = await response.json();
    console.log(data);
    return data.message.content;

  } else {
    let baseURL = "";
    let apiKey = "";
    
    if (lmProvider == "HUGGINGFACE") {
      modelName = process.env.HUGGINGFACE_MODEL || 'null';
      baseURL = `https://router.huggingface.co/hf-inference/models/${modelName}/v1`;
      apiKey = process.env.HUGGINGFACE_API_KEY || 'null';
    } else {
      modelName = process.env[`${lmProvider}_MODEL`] || 'null';
      baseURL = process.env[`${lmProvider}_BASE_URL`] || 'null';
      apiKey = process.env[`${lmProvider}_API_KEY`] || 'null';
    }
    const openai = new OpenAI({
      baseURL: baseURL,
      apiKey: apiKey,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/guy-dar/vibe-merge", 
        "X-Title": "vibe-merge", 
      },
    });
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {role: 'user', content: prompt}
      ],
    });
    if (!completion.choices || completion.choices.length === 0) {
      console.error("Error: No choices returned. Check usage limit or model.");
      return null;
    }
    const response = completion.choices[0].message.content;
    return response;
  }
}

interface MergePrompt {
  name: string;
  prompt: string;
}

function getMergePrompts(): MergePrompt[] {
  const promptsPath = path.resolve(__dirname, '..', 'src', 'prompts.yaml');
  const fileContents = fs.readFileSync(promptsPath, 'utf8');
  return yaml.load(fileContents) as MergePrompt[];
}

// New utility functions for code categorization
function categorizeCode(currentCode: string, clipboardCode: string): 'empty' | 'oneline' | 'multiline' {
  if (!currentCode.trim()) {
    return 'empty';
  }
  
  const clipLines = clipboardCode.trim().split('\n').length;
  if (clipLines <= 2) {
    return 'oneline';
  }
  return 'multiline';
}

function formatContextWithMarker(contextCode: string, existingCode: string, selectionOffset: number): string {
  const lines = contextCode.split('\n');
  const hasExistingCode = existingCode.trim().length > 0;
  
  if (hasExistingCode) {
    return contextCode.replace(existingCode, '👆 [EXISTING CODE START] 👆\n' + existingCode + '\n👇 [EXISTING CODE END] 👇');
  } else {
    // Find the line where selection starts within the context
    const linesBeforeSelection = contextCode.slice(0, selectionOffset).split('\n').length - 1;
    lines.splice(linesBeforeSelection, 0, '👉 [INSERTION POINT] 👈');
    return lines.join('\n');
  }
}

async function routeCodeMerge(currentCode: string, clipboardCode: string, contextCode?: string, selectionOffset?: number): Promise<string | null> {
  const category = categorizeCode(currentCode, clipboardCode);
  const mergePrompts = getMergePrompts();
  
  // Format context if available
  const formattedContext = contextCode ? formatContextWithMarker(contextCode, currentCode, selectionOffset || 0) : '';

  let selectedPrompt;
  switch (category) {
    case 'empty':
      selectedPrompt = mergePrompts.find(p => p.name === "empty")!;
      vscode.window.showInformationMessage('Using empty code adaptation strategy');
      break;
      
    case 'oneline':
      selectedPrompt = mergePrompts.find(p => p.name === "apply")!;
      vscode.window.showInformationMessage('Using apply transformation strategy');
      break;
      
    case 'multiline':
      const selectorPrompt = mergePrompts.find(p => p.name === "selector")!;
      const selectorPromptText = selectorPrompt.prompt
        .replace(/{{currentCode}}/g, currentCode)
        .replace(/{{clipboardCode}}/g, clipboardCode)
        .replace(/{{contextCode}}/g, formattedContext);
        
      const mergeType = await runLM(selectorPromptText);
      selectedPrompt = mergePrompts.find(p => mergeType?.includes(p.name)) 
        || mergePrompts.find(p => p.name === "standard")!;
      
      vscode.window.showInformationMessage(`Using ${selectedPrompt.name} merge strategy`);
      break;
  }

  // Format the prompt by replacing placeholders with actual values
  // console.log(`Selected prompt: ${selectedPrompt.prompt}`);
  let filledPrompt = selectedPrompt.prompt
    .replace(/{{currentCode}}/g, currentCode)
    .replace(/{{clipboardCode}}/g, clipboardCode);

  filledPrompt = filledPrompt.replace(/{{contextCode}}/g, formattedContext);
  
  return processCodeMerge(filledPrompt);
}

async function processCodeMerge(prompt: string): Promise<string | null> {
  console.log(`Prompt: ${prompt}`);
  const response = await runLM(prompt);
  if(response != null){
    console.log(`Response: ${response}`);
    const parts = response.split('``');
    return parts[parts.length - 2].replace(/^`\w*\n/g, ""); // remove leading backticks
  } else {
    return null;
  }
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
    
    // Get some context around the selected code (configurable buffer)
    const contextLines = 10;
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
  
    const originalUri = editor.document.uri;
    const selectionOffset = document.offsetAt(selection.start) - document.offsetAt(new vscode.Position(startLine, 0));
    const mergedCode = await routeCodeMerge(currentCode, clipboardCode, contextCode, selectionOffset);
    if (!mergedCode) {
      vscode.window.showErrorMessage('Failed to merge code');
      return;
    }
    const contents = {
      original: currentCode,
      modified: mergedCode
    };
  
    const scheme = 'vibe-merge';
    const provider = new VibeMergeProvider(contents);
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(scheme, provider)
    );
  
    const leftUri = vscode.Uri.parse(`${scheme}:/original`);
    const rightUri = vscode.Uri.parse(`${scheme}:/modified`);
  
    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, 'Vibe Merge Preview');
  
    const result = await vscode.window.showInformationMessage(
      'Apply Vibe Merge?',
      'Accept',
      'Discard'
    );
  
    if (result === 'Accept') {
      // Switch back to original document
      const doc = await vscode.workspace.openTextDocument(originalUri);
      const visibleEditor = await vscode.window.showTextDocument(doc);

      // Apply mergedCode at original selection
      await visibleEditor.edit(editBuilder => {
        editBuilder.replace(selection, mergedCode);
      });
      vscode.window.showInformationMessage('Merged code applied!');

    } else {
      vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  });
  
  context.subscriptions.push(command);
}

export function deactivate() {}