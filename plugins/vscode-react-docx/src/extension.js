const vscode = require("vscode");
const PreviewProvider = require("./preview-provider");

function activate(context) {
  console.log("🚀 React-DOCX Preview extension active!");

  const previewProvider = new PreviewProvider(context);

  const previewCommand = vscode.commands.registerCommand(
    "react-docx.preview",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor found");
        return;
      }

      const document = editor.document;
      if (!document.fileName.match(/\.(tsx|jsx)$/)) {
        vscode.window.showWarningMessage("Please open a .tsx or .jsx file");
        return;
      }

      previewProvider.showPreview(document);
    }
  );

  const exportCommand = vscode.commands.registerCommand(
    "react-docx.exportDocx",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor found");
        return;
      }

      const document = editor.document;
      if (!document.fileName.match(/\.(tsx|jsx)$/)) {
        vscode.window.showWarningMessage("Please open a .tsx or .jsx file");
        return;
      }

      previewProvider.exportDocx(document);
    }
  );

  // Auto-update preview on save
  const onSave = vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.fileName.match(/\.(tsx|jsx)$/) && previewProvider.panel) {
      previewProvider.updatePreview(document);
    }
  });

  context.subscriptions.push(previewCommand, exportCommand, onSave);
}

function deactivate() {
  console.log("React-DOCX Preview deactivated");
}

module.exports = { activate, deactivate };
