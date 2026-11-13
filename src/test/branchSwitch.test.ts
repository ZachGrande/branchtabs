import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, before, suite, test } from 'node:test';
import * as vscode from 'vscode';
import { BranchTabsManager, DISCARD_ALL, SAVE_ALL } from '../BranchTabsManager';
import type { GitExtension, Repository } from '../git';
import { TabState, lastBranchKey, stateKey } from '../tabState';

const repoRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
const DEBOUNCE_WAIT_MS = 800;

function git(...args: string[]): void {
	execFileSync('git', args, { cwd: repoRoot, stdio: 'ignore' });
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(description: string, condition: () => boolean, timeoutMs = 10000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) {
			assert.fail(`Timed out waiting for: ${description} (HEAD=${repo?.state.HEAD?.name}, tabs=${JSON.stringify(repoTabNames())})`);
		}
		await sleep(100);
	}
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
	git('checkout', '-q', branch);
	await waitFor(`HEAD to become ${branch}`, () => repo.state.HEAD?.name === branch);
}

/** Lets the debounced tab save run so the current layout is recorded for the current branch. */
function settle(): Promise<void> {
	return sleep(DEBOUNCE_WAIT_MS);
}

function sameItems(expected: string[]): () => boolean {
	return () => JSON.stringify(repoTabNames()) === JSON.stringify(expected);
}

suite('Branch switching', () => {
	before(async () => {
		const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'branch-tabs');
		assert.ok(ext, 'extension under test not found');
		await ext.activate();

		const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git')!;
		const api = (await gitExt.activate()).getAPI(1);
		await waitFor('git repository to open', () => api.repositories.length > 0);
		repo = api.repositories[0];
		await waitFor('HEAD to be main', () => repo.state.HEAD?.name === 'main');
		await closeAllEditors();
		await settle();
	});

	test('a branch without saved tabs keeps the current tabs', { timeout: 60000 }, async () => {
		await open('a.txt', 'b.txt');
		await settle();

		await checkout('feature');
		await sleep(DEBOUNCE_WAIT_MS);
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
			await waitFor('feature tabs restored', sameItems(['c.txt', 'a.txt']));
			const openUris = fileTabs().map(input => input.uri.toString());
			assert.ok(openUris.includes(vscode.Uri.file(outside).toString()), 'out-of-repo tab was closed');
			assert.ok(openUris.includes(untitled.uri.toString()), 'untitled tab was closed');

			await vscode.window.showTextDocument(untitled);
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
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

		const store = new Map<string, unknown>([
			[lastBranchKey(repoPath), previous],
			[stateKey(repoPath, current), { uris: [fileUri('b.txt')], activeUri: fileUri('b.txt') }],
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
		try {
			await manager.init();
			await waitFor('current branch tabs restored', sameItems(['b.txt']));
			assert.deepStrictEqual(store.get(stateKey(repoPath, previous)) as TabState, { uris: [fileUri('a.txt')], activeUri: fileUri('a.txt') });
			await waitFor('last branch updated', () => store.get(lastBranchKey(repoPath)) === current);
		} finally {
			manager.dispose();
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
			await waitFor('prompt shown', () => prompts === 1);
			await sleep(DEBOUNCE_WAIT_MS);
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
	});
});
