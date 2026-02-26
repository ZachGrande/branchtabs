# Branch Tabs

Remembers which files you had open on each git branch and restores them when you switch back.

## How It Works

Branch Tabs silently tracks the files you have open in VS Code per git branch. When you switch branches — whether via the VS Code UI, a terminal, or any other tool — the extension:

1. Saves the current set of open tabs (and which one is active) to the branch you're leaving.
2. Closes all open tabs.
3. Reopens the tabs that were saved for the branch you're switching to.

State is persisted in VS Code's workspace storage, so your tab sets survive editor restarts.

## Features

- **Automatic save** — tab state is written whenever tabs change (debounced to avoid excessive writes).
- **Automatic restore** — tabs are restored every time the git branch changes, including checkouts made in a terminal outside of VS Code.
- **Active tab tracking** — the file that had focus on the previous visit is re-focused when you return to a branch.
- **Unsaved file handling** — if you have unsaved changes when switching branches, you're prompted to save all, discard all, or cancel the tab switch.
- **New branch support** — on a branch with no saved state, the current open tabs are snapshotted as the starting state for that branch.
- **Output log** — a "Branch Tabs" output channel provides a timestamped trace of all extension activity for easy debugging.

## Requirements

- VS Code 1.109.0 or later.
- The built-in [Git extension](https://marketplace.visualstudio.com/items?itemName=vscode.git) must be enabled (it is by default).
- Your workspace must be a git repository.

## Extension Settings

This extension does not contribute any configurable settings.

## Known Limitations

- Only the first repository is tracked in multi-root workspaces that contain multiple git repositories.
- Only plain text file tabs (`file://` URIs) are saved and restored. Tabs such as diff views, notebooks, Settings UI, or extension output panels are not persisted.

## Release Notes

### 0.0.1

Initial release.

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
