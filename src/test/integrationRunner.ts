import * as path from 'node:path';
import { run as runNodeTests } from 'node:test';

export async function run(): Promise<void> {
	const stream = runNodeTests({
		files: [path.join(__dirname, 'branchSwitch.test.js')],
		isolation: 'none',
	});
	let failures = 0;
	let completed = 0;
	await new Promise<void>((resolve, reject) => {
		stream.on('test:pass', data => {
			if (data.details.type !== 'suite' && !data.skip && !data.todo) {
				completed++;
				console.log(`PASS ${data.name}`);
			}
			// The single top-level suite completes before the extension host exits.
			if (data.nesting === 0) {
				if (failures > 0 || completed === 0) {
					reject(new Error(`Integration tests failed: ${failures} failure(s), ${completed} passed.`));
				} else {
					resolve();
				}
			}
		});
		stream.on('test:fail', data => {
			failures++;
			console.error(`FAIL ${data.name}`, data.details.error);
			if (data.nesting === 0) {
				reject(new Error(`Integration tests failed: ${failures} failure(s), ${completed} passed.`));
			}
		});
		stream.on('error', reject);
		stream.on('end', () => reject(new Error('Integration test stream ended before the suite completed.')));
		stream.resume();
	});
}
