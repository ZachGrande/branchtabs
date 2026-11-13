import { defineConfig } from '@vscode/test-cli';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Integration tests run against a throwaway git repository with `main` and `feature` branches.
function createFixtureRepo() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'branch-tabs-fixture-')));
	const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Branch Tabs Test');
	git('config', 'commit.gpgsign', 'false');
	for (const name of ['a.txt', 'b.txt', 'c.txt']) {
		writeFileSync(join(dir, name), `${name}\n`);
	}
	git('add', '.');
	git('commit', '-q', '-m', 'initial');
	git('branch', 'feature');
	return dir;
}

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder: createFixtureRepo(),
	mocha: { timeout: 60000 },
});
