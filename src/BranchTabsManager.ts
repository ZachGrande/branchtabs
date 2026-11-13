import * as vscode from 'vscode';
import type { GitExtension, API, Repository } from './git';
import { TabState, buildTabState, isInsideRepo, lastBranchKey, stateKey } from './tabState';

const DEBOUNCE_MS = 500;

export const SAVE_ALL = 'Save All';
export const DISCARD_ALL = 'Discard All';

export class BranchTabsManager implements vscode.Disposable {
    private readonly context: vscode.ExtensionContext;
    private readonly output: vscode.OutputChannel;
    private repoPath: string | null = null;
    private currentBranch: string | null = null;
    /** True while a branch switch is in progress; suppresses tab-change saves. */
    private switching = false;
    /** Serializes branch switches so overlapping git events can't interleave. */
    private switchQueue: Promise<void> = Promise.resolve();
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.output = vscode.window.createOutputChannel('Branch Tabs');
        this.disposables.push(this.output);
    }

    private log(msg: string): void {
        const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
        this.output.appendLine(`[${ts}] ${msg}`);
    }

    async init(): Promise<void> {
        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!gitExtension) {
            this.log('ERROR: vscode.git extension not found.');
            vscode.window.showErrorMessage('Branch Tabs: Git extension not found.');
            return;
        }

        const exports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
        const gitApi = exports.getAPI(1);
        this.log(`Git API state: ${gitApi.state}`);

        if (gitApi.state === 'initialized') {
            this.setup(gitApi);
        } else {
            const disposable = gitApi.onDidChangeState(state => {
                if (state === 'initialized') {
                    disposable.dispose();
                    this.setup(gitApi);
                }
            });
            this.disposables.push(disposable);
        }
    }

    private setup(api: API): void {
        if (api.repositories.length > 0) {
            this.setupRepository(api.repositories[0]);
            return;
        }
        this.log('No repositories yet — waiting for onDidOpenRepository.');
        const disposable = api.onDidOpenRepository(repo => {
            disposable.dispose();
            this.setupRepository(repo);
        });
        this.disposables.push(disposable);
    }

    private setupRepository(repo: Repository): void {
        const repoPath = repo.rootUri.fsPath;
        this.repoPath = repoPath;
        const headBranch = repo.state.HEAD?.name ?? null;
        const lastBranch = this.context.workspaceState.get<string>(lastBranchKey(repoPath)) ?? null;
        this.log(`Tracking repository ${repoPath} (HEAD="${headBranch ?? '(detached)'}", last="${lastBranch ?? '(none)'}").`);

        // If the branch changed while VS Code was closed, the restored tabs still belong to lastBranch;
        // the sync below saves them there and switches to HEAD. HEAD may also not be known yet.
        this.currentBranch = lastBranch ?? headBranch;
        if (this.currentBranch) {
            if (!this.context.workspaceState.get<TabState>(stateKey(repoPath, this.currentBranch))) {
                void this.saveTabs(repoPath, this.currentBranch);
            }
            void this.context.workspaceState.update(lastBranchKey(repoPath), this.currentBranch);
        }

        this.disposables.push(
            vscode.window.tabGroups.onDidChangeTabs(() => this.scheduleSave()),
            vscode.window.tabGroups.onDidChangeTabGroups(() => this.scheduleSave()),
            // Fires on any HEAD change, including checkouts made from a terminal.
            repo.state.onDidChange(() => {
                if ((repo.state.HEAD?.name ?? null) !== this.currentBranch) {
                    this.enqueueSync(repo);
                }
            }),
            repo.onDidCheckout(() => this.enqueueSync(repo)),
        );
        this.enqueueSync(repo);
    }

    private scheduleSave(): void {
        if (this.switching || !this.currentBranch || !this.repoPath) {
            return;
        }
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            if (!this.switching && this.currentBranch && this.repoPath) {
                void this.saveTabs(this.repoPath, this.currentBranch);
            }
        }, DEBOUNCE_MS);
    }

    private enqueueSync(repo: Repository): void {
        this.switchQueue = this.switchQueue
            .then(() => this.syncToHead(repo))
            .catch(err => this.log(`ERROR during branch switch: ${err}`));
    }

    /** Brings tabs in line with the repository's current HEAD. Must only run via enqueueSync. */
    private async syncToHead(repo: Repository): Promise<void> {
        const repoPath = repo.rootUri.fsPath;
        const newBranch = repo.state.HEAD?.name ?? null;
        if (!newBranch || newBranch === this.currentBranch) {
            return;
        }

        const oldBranch = this.currentBranch;
        this.log(`Branch switch: "${oldBranch ?? '(none)'}" → "${newBranch}"`);

        this.switching = true;
        clearTimeout(this.debounceTimer);
        try {
            if (oldBranch) {
                await this.saveTabs(repoPath, oldBranch);
            }

            const saved = this.context.workspaceState.get<TabState>(stateKey(repoPath, newBranch));
            if (!saved) {
                this.log(`  No saved tabs for "${newBranch}" — keeping current tabs.`);
                await this.saveTabs(repoPath, newBranch);
            } else if (await this.resolveDirtyTabs(repoPath)) {
                await this.replaceTabs(repoPath, saved);
            } else {
                this.log(`  Switch cancelled — "${newBranch}" adopts the current tabs.`);
                await this.saveTabs(repoPath, newBranch);
            }

            this.currentBranch = newBranch;
            await this.context.workspaceState.update(lastBranchKey(repoPath), newBranch);
        } finally {
            this.switching = false;
        }
    }

    /** Returns the URI of a tab this extension manages: a text file inside the repository. */
    private trackedUri(tab: vscode.Tab, repoPath: string): vscode.Uri | undefined {
        if (tab.input instanceof vscode.TabInputText
            && tab.input.uri.scheme === 'file'
            && isInsideRepo(tab.input.uri.fsPath, repoPath)) {
            return tab.input.uri;
        }
        return undefined;
    }

    private trackedTabs(repoPath: string): vscode.Tab[] {
        return vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .filter(tab => this.trackedUri(tab, repoPath) !== undefined);
    }

    private async saveTabs(repoPath: string, branchName: string): Promise<void> {
        const uris = this.trackedTabs(repoPath).map(tab => this.trackedUri(tab, repoPath)!.toString());
        const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
        const activeUri = activeTab ? this.trackedUri(activeTab, repoPath)?.toString() ?? null : null;

        const state = buildTabState(uris, activeUri);
        await this.context.workspaceState.update(stateKey(repoPath, branchName), state);
        this.log(`Saved ${state.uris.length} tab(s) for "${branchName}".`);
    }

    /** Prompts about unsaved tabs that would be closed. Returns false if the user cancels. */
    private async resolveDirtyTabs(repoPath: string): Promise<boolean> {
        const dirtyTabs = this.trackedTabs(repoPath).filter(tab => tab.isDirty);
        if (dirtyTabs.length === 0) {
            return true;
        }

        const choice = await vscode.window.showWarningMessage(
            `Branch Tabs: You have ${dirtyTabs.length} unsaved file(s). What would you like to do before switching tabs to the new branch?`,
            { modal: true },
            SAVE_ALL,
            DISCARD_ALL,
        );
        this.log(`  Unsaved files prompt: ${choice ?? 'Cancel'}`);

        const dirtyUris = new Map(dirtyTabs.map(tab => {
            const uri = this.trackedUri(tab, repoPath)!;
            return [uri.toString(), uri];
        }));
        if (choice === SAVE_ALL) {
            let allSaved = true;
            for (const uri of dirtyUris.values()) {
                const document = await vscode.workspace.openTextDocument(uri);
                if (!await document.save()) {
                    this.log(`  Failed to save ${uri.fsPath}.`);
                    allSaved = false;
                }
            }
            return allSaved;
        }
        if (choice === DISCARD_ALL) {
            for (const uri of dirtyUris.values()) {
                // Reverting the document clears it for every editor showing it, so closing won't prompt.
                await vscode.window.showTextDocument(uri, { preview: false });
                await vscode.commands.executeCommand('workbench.action.files.revert');
            }
            return true;
        }
        return false;
    }

    private async replaceTabs(repoPath: string, state: TabState): Promise<void> {
        const toClose = this.trackedTabs(repoPath);
        if (toClose.length > 0) {
            await vscode.window.tabGroups.close(toClose, true);
        }

        let activeOpened = false;
        for (const uriString of state.uris) {
            const uri = vscode.Uri.parse(uriString);
            try {
                await vscode.workspace.fs.stat(uri);
            } catch {
                this.log(`  Skipping (missing on this branch): ${uri.fsPath}`);
                continue;
            }
            try {
                await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: true });
                activeOpened ||= uriString === state.activeUri;
            } catch (err) {
                this.log(`  Failed to open ${uri.fsPath}: ${err}`);
            }
        }

        if (state.activeUri && activeOpened) {
            await vscode.window.showTextDocument(vscode.Uri.parse(state.activeUri), { preview: false });
        }
        this.log(`  Restored tabs (${state.uris.length} saved).`);
    }

    dispose(): void {
        clearTimeout(this.debounceTimer);
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
