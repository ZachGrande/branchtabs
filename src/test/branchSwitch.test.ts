import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, before, suite, test } from 'node:test';
import * as vscode from 'vscode';
import { BranchTabsManager, DISCARD_ALL, SAVE_ALL } from '../BranchTabsManager';
import type { GitExtension, Repository } from '../git';
import { TabState, buildTabState, isInsideRepo, lastBranchKey, stateKey } from '../tabState';

const repoRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
const changes = new vscode.EventEmitter<void>();
const hooks: vscode.Disposable[] = [];
const savedTabs = new Map<string, TabState>();
let completedBranch: string | undefined;

function git(...args: string[]): void {
	execFileSync('git', args, { cwd: repoRoot, stdio: 'ignore' });
}

function waitFor(description: string, condition: () => boolean, timeoutMs = 10000): Promise<void> {
	return new Promise((resolve, reject) => {
		const finish = (error?: Error) => {
			clearTimeout(timer);
			hook.dispose();
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		};
		const check = () => {
			try {
				if (condition()) {
					finish();
				}
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		};
		const timer = setTimeout(() => {
			finish(new Error(`Timed out waiting for: ${description} (HEAD=${repo?.state.HEAD?.name}, tabs=${JSON.stringify(repoTabNames())})`));
		}, timeoutMs);
		const hook = changes.event(check);
		check();
	});
}

function fileTabs(): vscode.TabInputText[] {
	return vscode.window.tabGroups.all
		.flatMap(group => group.tabs)
		.map(tab => tab.input)
		.filter((input): input is vscode.TabInputText => input instanceof vscode.TabInputText);
}

/** Basenames of open text tabs inside the fixture repository, in tab order. */
function repoTabNames(): string[] {
	return fileTabs()
		.filter(input => input.uri.fsPath.startsWith(repoRoot + path.sep))
		.map(input => path.basename(input.uri.fsPath));
}

function activeTabName(): string | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	return input instanceof vscode.TabInputText ? path.basename(input.uri.fsPath) : undefined;
}

async function open(...names: string[]): Promise<void> {
	for (const name of names) {
		await vscode.window.showTextDocument(vscode.Uri.file(path.join(repoRoot, name)), { preview: false });
	}
}

async function closeAllEditors(): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

let repo: Repository;

async function checkout(branch: string): Promise<void> {
	completedBranch = undefined;
	git('checkout', '-q', branch);
	// Refresh the Git API after the external checkout instead of waiting for filesystem watchers.
	await repo.status();
	await waitFor(`branch switch to ${branch} to complete`, () => repo.state.HEAD?.name === branch && completedBranch === branch);
}

/** Waits for persistence of the current layout, not merely a tab-change notification. */
function settle(): Promise<void> {
	const uris = fileTabs()
		.filter(input => input.uri.scheme === 'file' && isInsideRepo(input.uri.fsPath, repoRoot))
		.map(input => input.uri.toString());
	const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	const expected = buildTabState(uris, active instanceof vscode.TabInputText ? active.uri.toString() : null);
	const key = stateKey(repo.rootUri.fsPath, repo.state.HEAD!.name!);
	return waitFor('current tab layout to be saved', () => JSON.stringify(savedTabs.get(key)) === JSON.stringify(expected));
}

function sameItems(expected: string[]): () => boolean {
	return () => JSON.stringify(repoTabNames()) === JSON.stringify(expected);
}

suite('Branch switching', () => {
	before(async () => {
		const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'branch-tabs');
		assert.ok(ext, 'extension under test not found');
		const manager = await vscode.extensions.getExtension<BranchTabsManager>(ext.id)!.activate();
		hooks.push(
			manager.onDidSaveTabs(({ repoPath, branchName, state }) => {
				savedTabs.set(stateKey(repoPath, branchName), state);
				changes.fire();
			}),
			manager.onDidSwitchBranch(({ repoPath, branchName }) => {
				if (repoPath === repo?.rootUri.fsPath) {
					completedBranch = branchName;
				}
				changes.fire();
			}),
			vscode.window.tabGroups.onDidChangeTabs(() => changes.fire()),
			vscode.window.tabGroups.onDidChangeTabGroups(() => changes.fire()),
			vscode.window.onDidChangeActiveTextEditor(() => changes.fire()),
		);

		const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git')!;
		const api = (await gitExt.activate()).getAPI(1);
		hooks.push(api.onDidOpenRepository(() => changes.fire()));
		await waitFor('git repository to open', () => api.repositories.length > 0);
		repo = api.repositories[0];
		hooks.push(repo.state.onDidChange(() => changes.fire()));
		await waitFor('HEAD to be main', () => repo.state.HEAD?.name === 'main');
		await closeAllEditors();
	});

	after(() => {
		hooks.forEach(hook => hook.dispose());
		changes.dispose();
	});

	suite('completion hooks', () => {
		test('continues immediately when already ready', async () => {
			await waitFor('already ready', () => true, 0);
		});

		test('rechecks readiness on a hook notification', async () => {
			let ready = false;
			let finished = false;
			const waiting = waitFor('hook notification', () => ready).then(() => { finished = true; });
			changes.fire();
			await Promise.resolve();
			assert.strictEqual(finished, false, 'unrelated events must not finish the wait');
			ready = true;
			changes.fire();
			await waiting;
		});

		test('fails with diagnostics when completion never arrives', async () => {
			await assert.rejects(waitFor('missing completion', () => false, 0), /Timed out waiting for: missing completion \(HEAD=.*, tabs=/);
		});
	});

	test('a branch without saved tabs keeps the current tabs', { timeout: 60000 }, async () => {
		await open('a.txt', 'b.txt');
		await settle();

		await checkout('feature');
		assert.deepStrictEqual(repoTabNames(), ['a.txt', 'b.txt']);
	});

	test('returning to a branch restores its tabs in order with the same active tab', { timeout: 60000 }, async () => {
		// feature: c, a (a active)
		await closeAllEditors();
		await open('c.txt', 'a.txt');
		await settle();

		await checkout('main');
		await waitFor('main tabs and active file restored', () => sameItems(['a.txt', 'b.txt'])() && activeTabName() === 'b.txt');
		assert.strictEqual(activeTabName(), 'b.txt');

		// main: b, c, a with c active
		await closeAllEditors();
		await open('b.txt', 'c.txt', 'a.txt', 'c.txt');
		await settle();

		await checkout('feature');
		await waitFor('feature tabs and active file restored', () => sameItems(['c.txt', 'a.txt'])() && activeTabName() === 'a.txt');
		assert.strictEqual(activeTabName(), 'a.txt');

		await checkout('main');
		await waitFor('main tabs and active file restored again', () => sameItems(['b.txt', 'c.txt', 'a.txt'])() && activeTabName() === 'c.txt');
		assert.strictEqual(activeTabName(), 'c.txt');
	});

	test('non-file and out-of-repo tabs are left open', { timeout: 60000 }, async () => {
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-tabs-outside-'));
		try {
			const outside = path.join(outsideDir, 'outside.txt');
			fs.writeFileSync(outside, 'outside\n');
			await vscode.window.showTextDocument(vscode.Uri.file(outside), { preview: false });
			const untitled = await vscode.workspace.openTextDocument({ content: 'scratch' });
			await vscode.window.showTextDocument(untitled, { preview: false });
			await settle();

			await checkout('feature');
			await waitFor('feature tabs and active file restored', () => sameItems(['c.txt', 'a.txt'])() && activeTabName() === 'a.txt');
			const openUris = fileTabs().map(input => input.uri.toString());
			assert.ok(openUris.includes(vscode.Uri.file(outside).toString()), 'out-of-repo tab was closed');
			assert.ok(openUris.includes(untitled.uri.toString()), 'untitled tab was closed');

			await vscode.window.showTextDocument(untitled);
			await waitFor('untitled editor focused', () => vscode.window.activeTextEditor?.document.uri.toString() === untitled.uri.toString());
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
			assert.deepStrictEqual(repoTabNames(), ['c.txt', 'a.txt'], 'closing the untitled editor must not close a repository tab');
			await checkout('main');
			await waitFor('main tabs restored', sameItems(['b.txt', 'c.txt', 'a.txt']));
			await closeAllEditors();
		} finally {
			fs.rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	test('files missing on the branch are skipped', { timeout: 60000 }, async () => {
		fs.writeFileSync(path.join(repoRoot, 'scratch.txt'), 'scratch\n');
		await open('a.txt', 'scratch.txt');
		await settle();

		await checkout('feature');
		await waitFor('feature tabs restored', sameItems(['c.txt', 'a.txt']));
		fs.rmSync(path.join(repoRoot, 'scratch.txt'));

		await checkout('main');
		await waitFor('main tabs restored without scratch.txt', sameItems(['a.txt']));
	});

	test('switches tabs on startup when the branch changed while VS Code was closed', { timeout: 60000 }, async () => {
		const current = repo.state.HEAD!.name!;
		const previous = current === 'main' ? 'feature' : 'main';
		const repoPath = repo.rootUri.fsPath;
		const fileUri = (name: string) => vscode.Uri.file(path.join(repoRoot, name)).toString();
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-tabs-legacy-'));
		const outsidePath = path.join(outsideDir, 'outside.txt');
		fs.writeFileSync(outsidePath, 'outside\n');
		const outsideUri = vscode.Uri.file(outsidePath).toString();

		const store = new Map<string, unknown>([
			[lastBranchKey(repoPath), previous],
			[stateKey(repoPath, current), { uris: [outsideUri, fileUri('b.txt')], activeUri: outsideUri }],
		]);
		const context = {
			workspaceState: {
				get: (key: string) => store.get(key),
				update: async (key: string, value: unknown) => { store.set(key, value); },
			},
		} as unknown as vscode.ExtensionContext;

		await closeAllEditors();
		await open('a.txt');
		await settle();

		const manager = new BranchTabsManager(context);
		let switched = false;
		const hook = manager.onDidSwitchBranch(() => {
			switched = true;
			changes.fire();
		});
		try {
			await manager.init();
			await waitFor('startup branch switch to complete', () => switched);
			assert.deepStrictEqual(repoTabNames(), ['b.txt']);
			assert.ok(!fileTabs().some(input => input.uri.toString() === outsideUri), 'legacy out-of-repo tab was restored');
			assert.notStrictEqual(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText
				? vscode.window.tabGroups.activeTabGroup.activeTab.input.uri.toString()
				: undefined, outsideUri, 'legacy out-of-repo active tab was focused');
			assert.deepStrictEqual(store.get(stateKey(repoPath, previous)) as TabState, { uris: [fileUri('a.txt')], activeUri: fileUri('a.txt') });
			assert.strictEqual(store.get(lastBranchKey(repoPath)), current);
		} finally {
			hook.dispose();
			manager.dispose();
			fs.rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	suite('with unsaved changes', () => {
		const original = vscode.window.showWarningMessage;
		let answer: string | undefined;
		let prompts = 0;

		before(() => {
			(vscode.window as { showWarningMessage: unknown }).showWarningMessage = async () => {
				prompts++;
				return answer;
			};
		});

		after(() => {
			(vscode.window as { showWarningMessage: unknown }).showWarningMessage = original;
		});

		async function makeDirty(name: string): Promise<vscode.TextDocument> {
			await open(name);
			const editor = vscode.window.activeTextEditor!;
			await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'unsaved '));
			assert.ok(editor.document.isDirty);
			return editor.document;
		}

		test('Cancel leaves the tabs untouched', { timeout: 60000 }, async () => {
			answer = undefined;
			prompts = 0;
			await closeAllEditors();
			const doc = await makeDirty('a.txt');
			await settle();

			await checkout('feature');
			assert.strictEqual(prompts, 1);
			assert.deepStrictEqual(repoTabNames(), ['a.txt']);
			assert.ok(doc.isDirty, 'unsaved changes were lost');
		});

		test('Discard All reverts unsaved files and switches tabs', { timeout: 60000 }, async () => {
			// After Cancel we're on feature with a dirty a.txt; reset feature's tabs to [b.txt].
			await vscode.commands.executeCommand('workbench.action.files.revert');
			await closeAllEditors();
			await open('b.txt');
			await settle();

			await checkout('main');
			await waitFor('main tabs restored', sameItems(['a.txt']));

			answer = DISCARD_ALL;
			prompts = 0;
			await makeDirty('a.txt');
			await settle();

			await checkout('feature');
			await waitFor('feature tabs restored', sameItems(['b.txt']));
			assert.strictEqual(prompts, 1);
			assert.strictEqual(fs.readFileSync(path.join(repoRoot, 'a.txt'), 'utf8'), 'a.txt\n');
			const a = vscode.workspace.textDocuments.find(d => d.uri.fsPath === path.join(repoRoot, 'a.txt'));
			assert.ok(!a?.isDirty, 'a.txt is still dirty');
		});

		test('Save All saves unsaved files and switches tabs', { timeout: 60000 }, async () => {
			const notes = path.join(repoRoot, 'notes.txt');
			fs.writeFileSync(notes, 'notes\n');
			await makeDirty('notes.txt');
			await settle();

			answer = SAVE_ALL;
			prompts = 0;
			await checkout('main');
			await waitFor('main tabs restored', sameItems(['a.txt']));
			assert.strictEqual(prompts, 1);
			assert.strictEqual(fs.readFileSync(notes, 'utf8'), 'unsaved notes\n');
		});

		test('queues a return to the original branch while a switch prompt is pending', { timeout: 60000 }, async () => {
			const current = repo.state.HEAD!.name!;
			const next = current === 'main' ? 'feature' : 'main';
			await closeAllEditors();
			await makeDirty('a.txt');

			let beginPrompt!: () => void;
			let releasePrompt!: (choice: string | undefined) => void;
			let firstPrompt = true;
			const promptStarted = new Promise<void>(resolve => { beginPrompt = resolve; });
			(vscode.window as { showWarningMessage: unknown }).showWarningMessage = async () => {
				if (firstPrompt) {
					firstPrompt = false;
					beginPrompt();
					return new Promise<string | undefined>(resolve => { releasePrompt = resolve; });
				}
				return undefined;
			};

			completedBranch = undefined;
			git('checkout', '-q', next);
			await repo.status();
			await promptStarted;

			git('checkout', '-q', current);
			await repo.status();
			await waitFor(`HEAD to return to ${current}`, () => repo.state.HEAD?.name === current);
			releasePrompt(undefined);
			await waitFor(`pending switch to settle on ${current}`, () => completedBranch === current);
			assert.strictEqual(repo.state.HEAD?.name, current);
			await vscode.commands.executeCommand('workbench.action.files.revert');
			await closeAllEditors();
		});
	});
});
