const { CompositeDisposable, Disposable } = require("atom");
const { pathToFileURL } = require("url");
const CallHierarchyView = require("./call-hierarchy-view");

class CallHierarchyPackage {
  constructor() {
    this.service = null;
    this.view = null;
    this.subscriptions = null;
  }

  activate() {
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      atom.commands.add("atom-text-editor:not([mini])", {
        "call-hierarchy:incoming-calls": () => this.showCalls("incoming"),
        "call-hierarchy:outgoing-calls": () => this.showCalls("outgoing"),
      }),
      atom.commands.add("atom-workspace", {
        "call-hierarchy:toggle": () => this.getView().toggle(),
      }),
    );
  }

  deactivate() {
    this.subscriptions?.dispose();
    this.subscriptions = null;
    const view = this.view;
    if (view) {
      const pane = atom.workspace.paneForItem(view);
      if (pane) {
        pane.destroyItem(view);
      } else {
        view.destroy();
      }
    }
    this.service = null;
  }

  consumeLanguageServer(service) {
    this.service = service;
    return new Disposable(() => {
      if (this.service === service) this.service = null;
    });
  }

  getView() {
    if (this.view === null) {
      this.view = new CallHierarchyView(() => this.service);
      this.view.onDidDestroy(() => {
        this.view = null;
      });
    }
    return this.view;
  }

  // Prepare a call hierarchy for the symbol under the cursor and show its
  // first item as the tree root in the dock. All requests route through the
  // origin editor: the language-server session is per project root, so the
  // editor pins the right session for the whole tree.
  async showCalls(direction) {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) return;
    if (!this.service) {
      atom.notifications.addInfo(
        "Call hierarchy is unavailable: no language-server hub is connected.",
      );
      return;
    }
    const filePath = editor.getPath();
    const session = filePath ? this.service.sessionForEditor(editor) : null;
    if (!session) {
      atom.notifications.addInfo("No language server is active for this file.");
      return;
    }
    if (!session.capabilities?.callHierarchyProvider) {
      const name = session.adapter?.displayName ?? "language server";
      atom.notifications.addInfo(`The ${name} does not support call hierarchy.`);
      return;
    }
    const position = editor.getCursorBufferPosition();
    let items;
    try {
      items = await this.service.request(editor, "textDocument/prepareCallHierarchy", {
        textDocument: { uri: pathToFileURL(filePath).href },
        position: { line: position.row, character: position.column },
      });
    } catch (error) {
      atom.notifications.addWarning("Call hierarchy request failed", {
        detail: error?.message ?? String(error),
        dismissable: true,
      });
      return;
    }
    if (!items || items.length === 0) {
      atom.notifications.addInfo("No symbol at cursor");
      return;
    }
    await this.getView().showItem(editor, items[0], direction);
  }
}

module.exports = new CallHierarchyPackage();
