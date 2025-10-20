const vscode = require("vscode");
const { renderToHtml, renderToBuffer } = require("@react-docx/core");
const babel = require("@babel/core");
const vm = require("vm");

// Resolve Babel plugins/presets from this extension's node_modules
const extensionDir = __dirname;

const resolveModule = (moduleName) => {
  try {
    return require.resolve(moduleName, { paths: [extensionDir] });
  } catch (err) {
    return moduleName;
  }
};

class PreviewProvider {
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.currentDocument = null;
    this.updateTimeout = null;
  }

  /**
   * Show preview panel for a document
   */
  async showPreview(document) {
    this.currentDocument = document;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "reactDocxPreview",
        "DOCX Preview",
        vscode.ViewColumn.Two,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = null;
        this.currentDocument = null;
      });
    }

    await this.renderPreview(document);
  }

  /**
   * Update preview if panel is open
   */
  async updatePreview(document) {
    if (!this.panel || !this.currentDocument) return;
    if (this.currentDocument.fileName !== document.fileName) return;

    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

    this.updateTimeout = setTimeout(async () => {
      await this.renderPreview(document);
    }, 500);
  }

  /**
   * Render the document preview
   */
  async renderPreview(document) {
    try {
      vscode.window.showInformationMessage("Rendering preview...");

      const code = document.getText();
      const html = await this.executeCodeToHtml(code, document.fileName);

      this.panel.webview.html = html;

      vscode.window.showInformationMessage("Preview updated!");
    } catch (error) {
      console.error("Error rendering preview:", error);
      this.panel.webview.html = this.getErrorContent(error);
      vscode.window.showErrorMessage(`Preview error: ${error.message}`);
    }
  }

  /**
   * Execute JSX/TSX code and render to HTML
   */
  async executeCodeToHtml(code, fileName) {
    try {
      // Transpile with Babel
      const babelConfig = {
        filename: fileName,
        presets: [
          [
            require(resolveModule("@babel/preset-react")),
            { runtime: "automatic" },
          ],
          [require(resolveModule("@babel/preset-typescript"))],
        ],
        plugins: [
          require(resolveModule("@babel/plugin-transform-modules-commonjs")),
        ],
        sourceMaps: false,
        babelrc: false,
        configFile: false,
      };

      const transpiled = babel.transformSync(code, babelConfig);
      if (!transpiled?.code) {
        throw new Error("Babel transpilation failed");
      }

      // Execute in VM context
      const React = require("react");
      const moduleCache = {
        react: React,
        "@react-docx/core": require("@react-docx/core"),
      };

      const customRequire = (moduleName) =>
        moduleCache[moduleName] || require(moduleName);

      const moduleExports = {};
      const moduleObject = { exports: moduleExports };

      const context = vm.createContext({
        require: customRequire,
        module: moduleObject,
        exports: moduleExports,
        console,
        process,
        Buffer,
        __filename: fileName,
        __dirname: require("path").dirname(fileName),
      });

      vm.runInContext(transpiled.code, context);

      const Component = moduleObject.exports.default || moduleObject.exports;
      if (typeof Component !== "function") {
        throw new Error("File must export a React component as default");
      }

      const element = React.createElement(Component);
      return renderToHtml(element);
    } catch (error) {
      throw new Error(`Code execution failed: ${error.message}`);
    }
  }

  /**
   * Execute JSX/TSX code and render to DOCX buffer (for export)
   */
  async executeCodeToBuffer(code, fileName) {
    try {
      // Transpile with Babel
      const babelConfig = {
        filename: fileName,
        presets: [
          [
            require(resolveModule("@babel/preset-react")),
            { runtime: "automatic" },
          ],
          [require(resolveModule("@babel/preset-typescript"))],
        ],
        plugins: [
          require(resolveModule("@babel/plugin-transform-modules-commonjs")),
        ],
        sourceMaps: false,
        babelrc: false,
        configFile: false,
      };

      const transpiled = babel.transformSync(code, babelConfig);
      if (!transpiled?.code) {
        throw new Error("Babel transpilation failed");
      }

      // Execute in VM context
      const React = require("react");
      const moduleCache = {
        react: React,
        "@react-docx/core": require("@react-docx/core"),
      };

      const customRequire = (moduleName) =>
        moduleCache[moduleName] || require(moduleName);

      const moduleExports = {};
      const moduleObject = { exports: moduleExports };

      const context = vm.createContext({
        require: customRequire,
        module: moduleObject,
        exports: moduleExports,
        console,
        process,
        Buffer,
        __filename: fileName,
        __dirname: require("path").dirname(fileName),
      });

      vm.runInContext(transpiled.code, context);

      const Component = moduleObject.exports.default || moduleObject.exports;
      if (typeof Component !== "function") {
        throw new Error("File must export a React component as default");
      }

      const element = React.createElement(Component);
      return await renderToBuffer(element);
    } catch (error) {
      throw new Error(`Code execution failed: ${error.message}`);
    }
  }

  /**
   * Export document to DOCX file
   */
  async exportDocx(document) {
    try {
      const code = document.getText();
      const buffer = await this.executeCodeToBuffer(code, document.fileName);

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          document.fileName.replace(/\.(tsx|jsx)$/, ".docx")
        ),
        filters: { "Word Documents": ["docx"] },
      });

      if (uri) {
        require("fs").writeFileSync(uri.fsPath, buffer);
        vscode.window.showInformationMessage(
          `Exported to ${require("path").basename(uri.fsPath)}`
        );

        const open = await vscode.window.showInformationMessage(
          "DOCX exported successfully!",
          "Open File"
        );

        if (open === "Open File") {
          vscode.env.openExternal(uri);
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Export error: ${error.message}`);
    }
  }

  /**
   * Get error content HTML
   */
  getErrorContent(error) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Preview Error</title>
        <style>
          body {
            margin: 0;
            padding: 40px;
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
            background: #f5f5f5;
          }
          .error-container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            max-width: 700px;
            margin: 0 auto;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          }
          h1 {
            color: #d32f2f;
            margin-top: 0;
            font-size: 24px;
          }
          pre {
            background: #f5f5f5;
            padding: 20px;
            border-radius: 4px;
            border-left: 4px solid #d32f2f;
            overflow-x: auto;
            font-size: 13px;
            line-height: 1.5;
          }
          .tips {
            background: #e3f2fd;
            padding: 20px;
            border-radius: 4px;
            margin-top: 20px;
            border-left: 4px solid #2196f3;
          }
          .tips h3 {
            margin-top: 0;
            color: #1976d2;
            font-size: 16px;
          }
          .tips ul {
            margin: 10px 0;
            padding-left: 20px;
          }
          .tips li {
            margin: 8px 0;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>⚠️ Preview Error</h1>
          <p>Failed to render the document preview:</p>
          <pre><code>${this.escapeHtml(error.message)}</code></pre>

          <div class="tips">
            <h3>💡 Tips:</h3>
            <ul>
              <li>Make sure your file exports a React component as the default export</li>
              <li>Check that you're using react-docx components (Document, Section, Paragraph, TextRun, etc.)</li>
              <li>Verify all imports are correct</li>
              <li>Check the console for detailed error messages</li>
            </ul>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Escape HTML special characters
   */
  escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

module.exports = PreviewProvider;
