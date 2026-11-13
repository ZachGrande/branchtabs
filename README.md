# Branch Tabs

Remembers which files you had open on each git branch and reopens them when you switch back.

## How It Works

Branch Tabs tracks the files you have open in VS Code for each git branch. When you switch branches, whether from the VS Code UI, a terminal, or another tool, the extension:

1. Saves the open file tabs (their order and which one was active) for the branch you're leaving.
2. If the branch you're switching to has saved tabs, closes the current file tabs and reopens that branch's tabs in the same order, re-focusing the file that was active.
3. If the branch you're switching to has no saved tabs yet (for example, a branch you just created), leaves your tabs as they are and remembers them for that branch.

Tab state is stored in VS Code's workspace storage, so it survives restarts. If the branch changed while VS Code was closed, your tabs are switched the next time the workspace opens.

## What Gets Swapped

- **Swapped:** text file tabs for files inside the repository.
- **Left alone:** everything else, including files outside the repository, untitled files, diffs, Settings, Markdown previews, webviews and other non-text editors.
- Files that don't exist on the branch you switch to are skipped.

## Unsaved Changes

If any of the file tabs that would be closed have unsaved changes, you're asked what to do:

- **Save All**: save those files, then switch tabs (if a save fails, your tabs are left as they are).
- **Discard All**: revert those files, then switch tabs.
- **Cancel**: keep your current tabs open. They become the saved tabs for the new branch.

## Requirements

- VS Code 1.109.0 or later.
- The built-in Git extension must be enabled (it is by default).
- Your workspace must be a git repository.

## Extension Settings

This extension does not contribute any settings.

## Known Limitations

- Only the first git repository in a workspace is tracked.
- Restored tabs open in the active editor group; split-editor layouts and pinned state are not restored.
- Tab order assumes the default `workbench.editor.openPositioning` setting (`right`).
- Detached HEAD states (e.g. during a rebase or bisect) are ignored until you're back on a branch.

## Troubleshooting

Open the **Output** panel and select **Branch Tabs** to see a timestamped log of what the extension is doing.

## Development

```sh
npm install
npm run compile   # type-check and build to out/
npm run lint
npm test          # unit + integration tests in a VS Code instance against a temporary git repository
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

## License

[MIT](LICENSE)
