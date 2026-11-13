import * as vscode from 'vscode';
import { BranchTabsManager } from './BranchTabsManager';

export function activate(context: vscode.ExtensionContext): void {
    const manager = new BranchTabsManager(context);
    context.subscriptions.push(manager);
    manager.init().catch(err => console.error('Branch Tabs failed to initialize:', err));
}

export function deactivate(): void {}
