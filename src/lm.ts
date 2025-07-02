import OpenAI from 'openai';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import fetch from 'node-fetch';
import * as path from 'path';
import * as vscode from 'vscode';


async function getLMProvider(): Promise<string> {
  const provider = process.env.LM_PROVIDER || 'null';
  if (provider === 'null') {
    throw new Error('LM_PROVIDER environment variable is not set.');
  }
  return provider;
}


async function runLM(prompt: string): Promise<string | null> {
  let lmProvider = await getLMProvider();
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

interface Prompt {
  name: string;
  prompt: string;
}

function getMergePrompts(): Prompt[] {
  const promptsPath = path.resolve(__dirname, '..', 'src', 'prompts.yaml');
  const fileContents = fs.readFileSync(promptsPath, 'utf8');
  return yaml.load(fileContents) as Prompt[];
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

export async function handleCodeMerge(currentCode: string, clipboardCode: string, 
                                      contextCode?: string, selectionOffset?: number,
                                      verbose: boolean = false, useSelectorPrompt: boolean = false): Promise<string | null> {
  const category = categorizeCode(currentCode, clipboardCode);
  const mergePrompts = getMergePrompts();
  
  // Format context if available
  const formattedContext = contextCode ? formatContextWithMarker(contextCode, currentCode, selectionOffset || 0) : '';

  let selectedPrompt;
  switch (category) {
    case 'empty':
      selectedPrompt = mergePrompts.find(p => p.name === "empty")!;
      break;
      
    case 'oneline':
      selectedPrompt = mergePrompts.find(p => p.name === "standard")!;
      break;
      
    case 'multiline':
      if(useSelectorPrompt) {
          const selectorPrompt = mergePrompts.find(p => p.name === "selector")!;
          const selectorPromptText = selectorPrompt.prompt
            .replace(/{{currentCode}}/g, currentCode)
            .replace(/{{clipboardCode}}/g, clipboardCode)
            .replace(/{{contextCode}}/g, formattedContext);
            
          const mergeType = await runLM(selectorPromptText);
          selectedPrompt = mergePrompts.find(p => mergeType?.includes(p.name)) 
            || mergePrompts.find(p => p.name === "standard")!;  
      } else {
          selectedPrompt = mergePrompts.find(p => p.name === "standard")!;
      }    
      break;
  }
  if(selectedPrompt && verbose){
      vscode.window.showInformationMessage(`Using ${selectedPrompt.name} merge strategy`);
  }

  // Format the prompt by replacing placeholders with actual values
  // console.log(`Selected prompt: ${selectedPrompt.prompt}`);
  let filledPrompt = selectedPrompt.prompt
    .replace(/{{currentCode}}/g, currentCode)
    .replace(/{{clipboardCode}}/g, clipboardCode);

  filledPrompt = filledPrompt.replace(/{{contextCode}}/g, formattedContext);
  return extractCodeFromPrompt(filledPrompt);
}

async function extractCodeFromPrompt(prompt: string): Promise<string | null> {
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
