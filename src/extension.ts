import * as vscode from 'vscode';
import { BranchTabsManager } from './BranchTabsManager';

let manager: BranchTabsManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
    manager = new BranchTabsManager(context);
    manager.init();
    context.subscriptions.push({ dispose: () => manager?.dispose() });
}

export function deactivate(): void {
    manager?.dispose();
}
