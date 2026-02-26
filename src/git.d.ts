// Minimal type declarations for the built-in vscode.git extension public API.
// Based on: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts

import { Uri, Event, Disposable } from 'vscode';

export interface Branch {
	readonly name?: string;
	readonly commit?: string;
	readonly upstream?: { name: string; remote: string };
}

export interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly onDidChange: Event<void>;
}

export interface Repository {
	readonly rootUri: Uri;
	readonly state: RepositoryState;
	/** Fires whenever the repository has been checked out to a different branch. */
	readonly onDidCheckout: Event<void>;
}

export interface API {
	readonly state: 'uninitialized' | 'initialized';
	readonly onDidChangeState: Event<'uninitialized' | 'initialized'>;
	readonly repositories: Repository[];
	readonly onDidOpenRepository: Event<Repository>;
}

export interface GitExtension {
	readonly enabled: boolean;
	readonly onDidChangeEnablement: Event<boolean>;
	getAPI(version: 1): API;
}
