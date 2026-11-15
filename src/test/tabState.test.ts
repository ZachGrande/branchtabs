import * as assert from 'assert';
import * as path from 'path';
import { suite, test } from 'node:test';
import { buildTabState, isInsideRepo, uniqueInOrder } from '../tabState';

suite('tabState', () => {
	test('isInsideRepo accepts nested files and rejects the root, siblings and parents', () => {
		const p = path.posix;
		assert.strictEqual(isInsideRepo('/repo/src/a.ts', '/repo', p), true);
		assert.strictEqual(isInsideRepo('/repo/..hidden', '/repo', p), true);
		assert.strictEqual(isInsideRepo('/repo', '/repo', p), false);
		assert.strictEqual(isInsideRepo('/repo-other/a.ts', '/repo', p), false);
		assert.strictEqual(isInsideRepo('/a.ts', '/repo', p), false);
	});

	test('isInsideRepo handles Windows paths', () => {
		const w = path.win32;
		assert.strictEqual(isInsideRepo('C:\\repo\\a.ts', 'C:\\repo', w), true);
		assert.strictEqual(isInsideRepo('D:\\repo\\a.ts', 'C:\\repo', w), false);
	});

	test('uniqueInOrder keeps the first occurrence', () => {
		assert.deepStrictEqual(uniqueInOrder(['b', 'a', 'b', 'c', 'a']), ['b', 'a', 'c']);
	});

	test('buildTabState dedupes and drops an active URI that is not tracked', () => {
		assert.deepStrictEqual(buildTabState(['x', 'y', 'x'], 'y'), { uris: ['x', 'y'], activeUri: 'y' });
		assert.deepStrictEqual(buildTabState(['x'], 'untracked'), { uris: ['x'], activeUri: null });
	});
});
