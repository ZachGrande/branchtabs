import * as vscode from 'vscode';
import type { GitExtension, API, Repository } from './git';

interface TabState {
    uris: string[];
    activeUri: string | null;
}

const DEBOUNCE_MS = 500;
const STATE_KEY_PREFIX = 'branch-tabs:';

export class BranchTabsManager {
    private context: vscode.ExtensionContext;
    private output: vscode.OutputChannel;
    private currentBranch: string | null = null;
    private isRestoring = false;
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private disposables: vscode.Disposable[] = [];

    private log(msg: string): void {
        const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
        this.output.appendLine(`[${ts}] ${msg}`);
    }

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.output = vscode.window.createOutputChannel('Branch Tabs');
        this.disposables.push(this.output);
        this.log('BranchTabsManager created.');
    }

    async init(): Promise<void> {
        this.log('init() called.');
        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!gitExtension) {
            this.log('ERROR: vscode.git extension not found.');
            vscode.window.showErrorMessage('Branch Tabs: Git extension not found.');
            return;
        }
        this.log(`vscode.git found. isActive=${gitExtension.isActive}`);

        const gitApi = gitExtension.exports.getAPI(1);
        this.log(`Git API state: ${gitApi.state}`);

        if (gitApi.state === 'initialized') {
            this.setup(gitApi);
        } else {
            this.log('Waiting for git API to initialize...');
            const disposable = gitApi.onDidChangeState(state => {
                this.log(`Git API state changed to: ${state}`);
                if (state === 'initialized') {
                    disposable.dispose();
                    this.setup(gitApi);
                }
            });
            this.disposables.push(disposable);
        }
    }

    private setup(api: API): void {
        this.log(`setup() called. Repositories: ${api.repositories.length}`);
        if (api.repositories.length === 0) {
            this.log('No repositories yet — waiting for onDidOpenRepository.');
            const disposable = api.onDidOpenRepository(repo => {
                this.log(`onDidOpenRepository fired: ${repo.rootUri.fsPath}`);
                disposable.dispose();
                this.setupRepository(repo);
            });
            this.disposables.push(disposable);
        } else {
            this.setupRepository(api.repositories[0]);
        }
    }

    private setupRepository(repo: Repository): void {
        const repoPath = repo.rootUri.fsPath;
        const initialBranch = repo.state.HEAD?.name ?? null;
        this.log(`setupRepository() path=${repoPath}`);
        this.log(`  Initial branch: ${initialBranch ?? '(detached/unknown)'}`);

        this.currentBranch = initialBranch;

        // Snapshot current tabs if no saved state exists yet for this branch
        if (this.currentBranch) {
            const key = this.stateKey(repoPath, this.currentBranch);
            const existing = this.context.workspaceState.get<TabState>(key);
            if (!existing) {
                this.log(`  No saved state for "${this.currentBranch}" — snapshotting current tabs.`);
                this.saveTabs(repoPath, this.currentBranch);
            } else {
                this.log(`  Saved state for "${this.currentBranch}": ${existing.uris.length} URI(s).`);
            }
        }

        // Debounced save on every tab change
        const tabsDisposable = vscode.window.tabGroups.onDidChangeTabs(() => {
            if (this.isRestoring || !this.currentBranch) {
                return;
            }
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                if (this.currentBranch) {
                    this.log(`  Tab change debounce fired — saving tabs for "${this.currentBranch}".`);
                    this.saveTabs(repoPath, this.currentBranch);
                }
            }, DEBOUNCE_MS);
        });
        this.disposables.push(tabsDisposable);

        // Primary detector: fires whenever HEAD changes (catches terminal checkouts too)
        const stateDisposable = repo.state.onDidChange(() => {
            const newBranch = repo.state.HEAD?.name ?? null;
            this.log(`  repo.state.onDidChange: HEAD="${newBranch}", tracked="${this.currentBranch}"`);
            if (newBranch !== this.currentBranch) {
                this.handleCheckout(repo);
            }
        });
        this.disposables.push(stateDisposable);

        // Secondary detector: belt-and-suspenders
        const checkoutDisposable = repo.onDidCheckout(() => {
            const newBranch = repo.state.HEAD?.name ?? null;
            this.log(`  onDidCheckout fired. HEAD="${newBranch}", tracked="${this.currentBranch}"`);
            this.handleCheckout(repo);
        });
        this.disposables.push(checkoutDisposable);

        this.log('  Listeners attached. Extension is active.');
    }

    private saveTabs(repoPath: string, branchName: string): void {
        const uris: string[] = [];

        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (tab.input instanceof vscode.TabInputText) {
                    const uri = tab.input.uri;
                    if (uri.scheme === 'file') {
                        uris.push(uri.toString());
                    }
                }
            }
        }

        const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
        let activeUri: string | null = null;
        if (activeTab?.input instanceof vscode.TabInputText) {
            const uri = (activeTab.input as vscode.TabInputText).uri;
            if (uri.scheme === 'file') {
                activeUri = uri.toString();
            }
        }

        const state: TabState = { uris, activeUri };
        this.context.workspaceState.update(this.stateKey(repoPath, branchName), state);
        this.log(`saveTabs("${branchName}"): ${uris.length} URI(s), active=${activeUri?.split('/').pop() ?? 'none'}`);
    }

    private async handleCheckout(repo: Repository): Promise<void> {
        const newBranch = repo.state.HEAD?.name ?? null;
        this.log(`handleCheckout(): newBranch="${newBranch}", currentBranch="${this.currentBranch}"`);

        if (!newBranch) {
            this.log('  Detached HEAD — aborting.');
            return;
        }

        if (newBranch === this.currentBranch) {
            this.log('  Same branch — no-op.');
            return;
        }

        const oldBranch = this.currentBranch;
        this.log(`  Switching: "${oldBranch}" → "${newBranch}"`);

        // Flush debounce and immediately persist tabs for the outgoing branch
        clearTimeout(this.debounceTimer);
        if (oldBranch) {
            this.log(`  Flushing save for old branch "${oldBranch}".`);
            this.saveTabs(repo.rootUri.fsPath, oldBranch);
        }

        // Check for dirty files
        const proceed = await this.handleDirtyFiles();
        if (!proceed) {
            this.log('  User cancelled — updating branch tracker, leaving tabs alone.');
            this.currentBranch = newBranch;
            return;
        }

        this.currentBranch = newBranch;
        await this.switchTabs(repo.rootUri.fsPath, newBranch);
    }

    private async handleDirtyFiles(): Promise<boolean> {
        const allTabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
        const dirtyTabs = allTabs.filter(tab => tab.isDirty);
        this.log(`  Dirty tabs: ${dirtyTabs.length}`);

        if (dirtyTabs.length === 0) {
            return true;
        }

        const saveAll = 'Save All';
        const discardAll = 'Discard All';
        const cancel = 'Cancel';

        const choice = await vscode.window.showWarningMessage(
            `You have ${dirtyTabs.length} unsaved file(s). What would you like to do before switching branches?`,
            { modal: true },
            saveAll,
            discardAll,
            cancel
        );

        this.log(`  Dirty files prompt result: "${choice}"`);

        if (choice === saveAll) {
            await vscode.workspace.saveAll(false);
            return true;
        } else if (choice === discardAll) {
            await vscode.window.tabGroups.close(dirtyTabs);
            return true;
        }

        return false;
    }

    private async switchTabs(repoPath: string, branchName: string): Promise<void> {
        this.log(`switchTabs("${branchName}"): closing all tabs.`);
        this.isRestoring = true;
        try {
            const allTabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
            this.log(`  Closing ${allTabs.length} tab(s).`);
            if (allTabs.length > 0) {
                await vscode.window.tabGroups.close(allTabs);
            }
            await this.restoreTabs(repoPath, branchName);
        } finally {
            this.isRestoring = false;
        }
    }

    private async restoreTabs(repoPath: string, branchName: string): Promise<void> {
        const state = this.context.workspaceState.get<TabState>(
            this.stateKey(repoPath, branchName)
        );

        this.log(`restoreTabs("${branchName}"): saved state=${state ? `${state.uris.length} URI(s)` : 'none'}`);

        if (!state || state.uris.length === 0) {
            this.log('  Nothing to restore.');
            return;
        }

        for (const uriString of state.uris) {
            if (uriString === state.activeUri) {
                continue;
            }

            const uri = vscode.Uri.parse(uriString);
            const fileName = uriString.split('/').pop();

            try {
                await vscode.workspace.fs.stat(uri);
            } catch {
                this.log(`  Skipping (not on this branch): ${fileName}`);
                continue;
            }

            try {
                await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: true });
                this.log(`  Opened: ${fileName}`);
            } catch (err) {
                this.log(`  Failed to open ${fileName}: ${err}`);
            }
        }

        if (state.activeUri) {
            const activeUri = vscode.Uri.parse(state.activeUri);
            const fileName = state.activeUri.split('/').pop();
            try {
                await vscode.workspace.fs.stat(activeUri);
                await vscode.window.showTextDocument(activeUri, { preview: false, preserveFocus: false });
                this.log(`  Focused: ${fileName}`);
            } catch {
                this.log(`  Active file not on this branch: ${fileName}`);
            }
        }

        this.log(`restoreTabs("${branchName}"): complete.`);
    }

    private stateKey(repoPath: string, branchName: string): string {
        return `${STATE_KEY_PREFIX}${repoPath}:${branchName}`;
    }

    dispose(): void {
        this.log('dispose() called.');
        clearTimeout(this.debounceTimer);
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
