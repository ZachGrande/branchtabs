import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
	const tempRoot = process.platform === 'darwin' ? '/tmp' : tmpdir();
	const dir = realpathSync(mkdtempSync(path.join(tempRoot, 'bt-')));
	try {
		const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
		git('init', '-q', '-b', 'main');
		git('config', 'user.email', 'test@example.com');
		git('config', 'user.name', 'Branch Tabs Test');
		git('config', 'commit.gpgsign', 'false');
		for (const name of ['a.txt', 'b.txt', 'c.txt']) {
			writeFileSync(path.join(dir, name), `${name}\n`);
		}
		git('add', '.');
		git('commit', '-q', '-m', 'initial');
		git('branch', 'feature');

		await runTests({
			extensionDevelopmentPath: path.resolve(__dirname, '../..'),
			extensionTestsPath: path.join(__dirname, 'integrationRunner.js'),
			launchArgs: [dir, '--disable-extensions', '--user-data-dir', path.join(dir, 'profile')],
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

main().catch(error => {
	console.error('Integration tests failed:', error);
	process.exitCode = 1;
});
