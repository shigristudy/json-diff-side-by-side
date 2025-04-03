import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

// Keep track of the current webview panel
let currentPanel: vscode.WebviewPanel | undefined = undefined;

// Tracks the content of both editors
interface JsonEditors {
  leftContent: string;
  rightContent: string;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('JSON Diff Side-by-Side extension is now active');

  // Register the command to open the JSON diff view
  const openDiffViewCommand = vscode.commands.registerCommand('json-diff-side-by-side.openDiffView', () => {
    vscode.window.showInformationMessage('Opening JSON Diff Side-by-Side View');
    createOrShowDiffPanel(context);
  });

  // Register the view
  const jsonDiffActionsProvider = new class implements vscode.TreeDataProvider<JsonDiffActionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<JsonDiffActionItem | undefined | null> = new vscode.EventEmitter<JsonDiffActionItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<JsonDiffActionItem | undefined | null> = this._onDidChangeTreeData.event;

    refresh(): void {
      this._onDidChangeTreeData.fire(null);
    }

    getTreeItem(element: JsonDiffActionItem): vscode.TreeItem {
      return element;
    }

    getChildren(element?: JsonDiffActionItem): Thenable<JsonDiffActionItem[]> {
      if (element) {
        return Promise.resolve([]);
      } else {
        return Promise.resolve([
          new JsonDiffActionItem(
            'Open JSON Diff Viewer',
            'json-diff-side-by-side.openDiffView',
            vscode.TreeItemCollapsibleState.None
          )
        ]);
      }
    }
  };

  vscode.window.registerTreeDataProvider('jsonDiffActions', jsonDiffActionsProvider);

  // Register the command to load a file into the left editor
  const loadLeftCommand = vscode.commands.registerCommand('json-diff-side-by-side.loadLeft', async () => {
    if (currentPanel) {
      const content = await loadJsonFile();
      if (content) {
        currentPanel.webview.postMessage({ 
          command: 'setLeftContent', 
          content 
        });
      }
    } else {
      vscode.window.showErrorMessage("Please open the JSON Diff view first");
    }
  });

  // Register the command to load a file into the right editor
  const loadRightCommand = vscode.commands.registerCommand('json-diff-side-by-side.loadRight', async () => {
    if (currentPanel) {
      const content = await loadJsonFile();
      if (content) {
        currentPanel.webview.postMessage({ 
          command: 'setRightContent', 
          content 
        });
      }
    } else {
      vscode.window.showErrorMessage("Please open the JSON Diff view first");
    }
  });

  // Register the command to compare JSON
  const compareJsonCommand = vscode.commands.registerCommand('json-diff-side-by-side.compareJson', () => {
    if (currentPanel) {
      currentPanel.webview.postMessage({ command: 'compare' });
    } else {
      vscode.window.showErrorMessage("Please open the JSON Diff view first");
    }
  });

  // Add the commands to subscriptions
  context.subscriptions.push(
    openDiffViewCommand,
    loadLeftCommand,
    loadRightCommand,
    compareJsonCommand
  );
}

/**
 * Tree item representing an action in the JSON Diff sidebar
 */
class JsonDiffActionItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly commandId?: string, 
    public readonly collapsibleState?: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    
    if (commandId) {
      this.command = {
        command: commandId,
        title: label
      };
    }

    this.iconPath = new vscode.ThemeIcon('json');
  }
}

/**
 * Creates or shows the webview panel for JSON diffing.
 */
function createOrShowDiffPanel(context: vscode.ExtensionContext) {
  const columnToShowIn = vscode.window.activeTextEditor
    ? vscode.window.activeTextEditor.viewColumn
    : undefined;

  // If we already have a panel, reveal it
  if (currentPanel) {
    currentPanel.reveal(columnToShowIn);
    return;
  }

  // Create and show a new webview panel
  currentPanel = vscode.window.createWebviewPanel(
    'jsonDiffViewer',
    'JSON Diff Viewer',
    columnToShowIn || vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    }
  );

  // Set the webview content
  currentPanel.webview.html = getWebviewContent();

  // Handle messages from the webview
  currentPanel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case 'alert':
          vscode.window.showInformationMessage(message.text);
          return;
        
        case 'error':
          vscode.window.showErrorMessage(message.text);
          return;
          
        case 'showDiff':
          showDiff(message.left, message.right);
          return;
          
        case 'loadLeft':
          // Handle loadLeft message from webview
          vscode.commands.executeCommand('json-diff-side-by-side.loadLeft');
          return;
          
        case 'loadRight':
          // Handle loadRight message from webview
          vscode.commands.executeCommand('json-diff-side-by-side.loadRight');
          return;
      }
    },
    undefined,
    context.subscriptions
  );

  // Reset when the panel is closed
  currentPanel.onDidDispose(
    () => {
      currentPanel = undefined;
    },
    null,
    context.subscriptions
  );
}

/**
 * Shows the diff between two JSON texts using VS Code's built-in diff editor
 */
async function showDiff(leftJson: string, rightJson: string) {
  try {
    // Create temp documents for the diff editor
    const leftDoc = await vscode.workspace.openTextDocument({
      content: formatJson(leftJson),
      language: 'json'
    });
    
    const rightDoc = await vscode.workspace.openTextDocument({
      content: formatJson(rightJson),
      language: 'json'
    });

    // Show the diff editor
    await vscode.commands.executeCommand('vscode.diff', 
      leftDoc.uri, 
      rightDoc.uri, 
      'JSON Diff Comparison'
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to show diff: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Helper function to load a JSON file
 */
async function loadJsonFile(): Promise<string | undefined> {
  const options: vscode.OpenDialogOptions = {
    canSelectMany: false,
    openLabel: 'Open JSON File',
    filters: {
      'JSON files': ['json'],
      'All files': ['*']
    }
  };

  const fileUri = await vscode.window.showOpenDialog(options);
  
  if (fileUri && fileUri[0]) {
    try {
      const content = await fs.readFile(fileUri[0].fsPath, 'utf8');
      
      // Validate and format JSON before returning
      try {
        JSON.parse(content);
        return formatJson(content);
      } catch (e) {
        vscode.window.showErrorMessage(`Selected file doesn't contain valid JSON: ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load file: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
  return undefined;
}

/**
 * Formats JSON string or returns original if invalid
 */
function formatJson(jsonString: string): string {
  try {
    const parsed = JSON.parse(jsonString);
    return JSON.stringify(parsed, null, 2);
  } catch (e) {
    return jsonString; // Return original if parsing fails
  }
}

/**
 * Returns the HTML content for the webview
 */
function getWebviewContent() {
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JSON Diff Viewer</title>
    <style>
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        background-color: var(--vscode-editor-background);
        padding: 10px;
      }
      
      .container {
        display: flex;
        flex-direction: column;
        height: 100vh;
        max-height: 100vh;
      }
      
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      
      .title {
        font-size: 1.2em;
        font-weight: bold;
      }
      
      .button-group {
        display: flex;
        gap: 8px;
      }
      
      button {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 6px 12px;
        border-radius: 2px;
        cursor: pointer;
        font-size: 13px;
      }
      
      button:hover {
        background-color: var(--vscode-button-hoverBackground);
      }
      
      .editors {
        display: flex;
        flex-grow: 1;
        gap: 10px;
        overflow: hidden;
        height: calc(100% - 90px);
      }
      
      .editor-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        height: 100%;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 3px;
        overflow: hidden;
      }
      
      .editor-header {
        background-color: var(--vscode-editor-inactiveSelectionBackground);
        padding: 5px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: bold;
      }
      
      .editor {
        width: 100%;
        height: 100%;
        resize: none;
        box-sizing: border-box;
        background-color: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: 'Courier New', monospace;
        padding: 10px;
        border: none;
        outline: none;
        overflow: auto;
      }
      
      .footer {
        padding: 10px;
        margin-top: 10px;
        text-align: center;
        font-size: 0.9em;
        color: var(--vscode-descriptionForeground);
      }
      
      .compare-button {
        background-color: var(--vscode-button-background);
        padding: 8px 16px;
        font-size: 14px;
        font-weight: bold;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="title">JSON Diff Side-by-Side</div>
        <div class="button-group">
          <button id="compareBtn" class="compare-button">Compare JSON</button>
        </div>
      </div>
      
      <div class="editors">
        <div class="editor-container">
          <div class="editor-header">
            <span>Left JSON</span>
            <button id="loadLeftBtn">Load File</button>
          </div>
          <textarea id="leftEditor" class="editor" placeholder="Paste your JSON here or load a file..."></textarea>
        </div>
        
        <div class="editor-container">
          <div class="editor-header">
            <span>Right JSON</span>
            <button id="loadRightBtn">Load File</button>
          </div>
          <textarea id="rightEditor" class="editor" placeholder="Paste your JSON here or load a file..."></textarea>
        </div>
      </div>
      
      <div class="footer">
        Enter or paste JSON in both editors, then click "Compare JSON" to visualize differences.
      </div>
    </div>
    
    <script>
      (function() {
        const vscode = acquireVsCodeApi();
        
        // Elements
        const leftEditor = document.getElementById('leftEditor');
        const rightEditor = document.getElementById('rightEditor');
        const compareBtn = document.getElementById('compareBtn');
        const loadLeftBtn = document.getElementById('loadLeftBtn');
        const loadRightBtn = document.getElementById('loadRightBtn');
        
        // Store editor contents for when the webview becomes hidden
        let state = vscode.getState() || { leftContent: '', rightContent: '' };
        
        // Initialize editors with stored content if available
        if (state.leftContent) {
          leftEditor.value = state.leftContent;
        }
        
        if (state.rightContent) {
          rightEditor.value = state.rightContent;
        }

        // Format JSON when pasted or changed with a debounce
        let leftTimeout;
        let rightTimeout;
        
        leftEditor.addEventListener('input', function() {
          clearTimeout(leftTimeout);
          leftTimeout = setTimeout(() => {
            formatEditorContent(leftEditor);
          }, 500);
        });
        
        rightEditor.addEventListener('input', function() {
          clearTimeout(rightTimeout);
          rightTimeout = setTimeout(() => {
            formatEditorContent(rightEditor);
          }, 500);
        });
        
        // Handle paste events to format JSON immediately
        leftEditor.addEventListener('paste', function() {
          setTimeout(() => formatEditorContent(leftEditor), 0);
        });
        
        rightEditor.addEventListener('paste', function() {
          setTimeout(() => formatEditorContent(rightEditor), 0);
        });
        
        // Button event handlers
        compareBtn.addEventListener('click', function() {
          compareJson();
        });
        
        loadLeftBtn.addEventListener('click', function() {
          // Fix: use correct command format
          vscode.postMessage({ command: 'loadLeft' });
        });
        
        loadRightBtn.addEventListener('click', function() {
          // Fix: use correct command format
          vscode.postMessage({ command: 'loadRight' });
        });

        // Format JSON in editor
        function formatEditorContent(editor) {
          const jsonText = editor.value.trim();
          if (!jsonText) return;

          try {
            const parsedJson = JSON.parse(jsonText);
            editor.value = JSON.stringify(parsedJson, null, 2);
            
            // Update state
            updateState();
          } catch (error) {
            // Don't format if JSON is invalid - let the compare function handle errors
          }
        }

        // Update state with current editor contents
        function updateState() {
          const newState = { 
            leftContent: leftEditor.value, 
            rightContent: rightEditor.value 
          };
          vscode.setState(newState);
          state = newState;
        }
        
        // Compare JSON function
        function compareJson() {
          const leftJson = leftEditor.value.trim();
          const rightJson = rightEditor.value.trim();
          
          if (!leftJson && !rightJson) {
            vscode.postMessage({
              command: 'error',
              text: 'Both editors are empty. Please enter JSON content to compare.'
            });
            return;
          }
          
          if (!leftJson) {
            vscode.postMessage({
              command: 'error',
              text: 'Left editor is empty. Please enter JSON content to compare.'
            });
            return;
          }
          
          if (!rightJson) {
            vscode.postMessage({
              command: 'error',
              text: 'Right editor is empty. Please enter JSON content to compare.'
            });
            return;
          }
          
          // Validate JSON before sending
          try {
            JSON.parse(leftJson);
          } catch (e) {
            vscode.postMessage({
              command: 'error',
              text: 'Left editor contains invalid JSON: ' + e.message
            });
            return;
          }
          
          try {
            JSON.parse(rightJson);
          } catch (e) {
            vscode.postMessage({
              command: 'error',
              text: 'Right editor contains invalid JSON: ' + e.message
            });
            return;
          }
          
          // Send both contents to the extension
          vscode.postMessage({
            command: 'showDiff',
            left: leftJson,
            right: rightJson
          });
        }
        
        // Handle messages from the extension
        window.addEventListener('message', event => {
          const message = event.data;
          
          switch (message.command) {
            case 'setLeftContent':
              leftEditor.value = message.content;
              updateState();
              break;
              
            case 'setRightContent':
              rightEditor.value = message.content;
              updateState();
              break;
              
            case 'compare':
              compareJson();
              break;
          }
        });
      }());
    </script>
  </body>
  </html>`;
}

export function deactivate() {}
