import * as path from 'path';

export interface TabState {
    /** File URIs (as strings) in the order they appeared across editor groups. */
    uris: string[];
    activeUri: string | null;
}

const STATE_KEY_PREFIX = 'branch-tabs:';
const LAST_BRANCH_KEY_PREFIX = 'branch-tabs-last:';

export function stateKey(repoPath: string, branchName: string): string {
    return `${STATE_KEY_PREFIX}${repoPath}:${branchName}`;
}

export function lastBranchKey(repoPath: string): string {
    return `${LAST_BRANCH_KEY_PREFIX}${repoPath}`;
}

export function isInsideRepo(filePath: string, repoRoot: string, pathModule: path.PlatformPath = path): boolean {
    const relative = pathModule.relative(repoRoot, filePath);
    return relative !== ''
        && relative !== '..'
        && !relative.startsWith(`..${pathModule.sep}`)
        && !pathModule.isAbsolute(relative);
}

export function uniqueInOrder<T>(items: readonly T[]): T[] {
    return [...new Set(items)];
}

export function buildTabState(uris: readonly string[], activeUri: string | null): TabState {
    const unique = uniqueInOrder(uris);
    return {
        uris: unique,
        activeUri: activeUri !== null && unique.includes(activeUri) ? activeUri : null,
    };
}
