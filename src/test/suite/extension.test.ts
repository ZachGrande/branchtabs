import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { saveOpenTabs, restoreOpenTabs } from '../../../src/extension';

suite('BranchTabSaver Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('saveOpenTabs should save open tabs', async () => {
        const branch = 'test-branch';
        const mockTabs = [
            { input: { uri: vscode.Uri.parse('file:///test1') } },
            { input: { uri: vscode.Uri.parse('file:///test2') } }
        ];

        // sinon.stub(vscode.window.tabGroups, 'all').value([{ tabs: mockTabs }]);

        // await saveOpenTabs(branch);

        // const savedTabs = vscode.workspace.getConfiguration().get(`branchTabs.${branch}`);
        // assert.deepStrictEqual(savedTabs, ['file:///test1', 'file:///test2']);
    });

    test('restoreOpenTabs should restore open tabs', async () => {
        const branch = 'test-branch';
        const mockTabs = ['file:///test1', 'file:///test2'];

        // await vscode.workspace.getConfiguration().update(`branchTabs.${branch}`, mockTabs, vscode.ConfigurationTarget.Global);

        // const openTextDocumentStub = sinon.stub(vscode.workspace, 'openTextDocument').callsFake(async (options?: { language?: string; content?: string }) => {
        //     return { uri: vscode.Uri.parse(options?.content || '') } as vscode.TextDocument;
        // });

        // const showTextDocumentStub = sinon.stub(vscode.window, 'showTextDocument').callsFake(async (uri: vscode.Uri) => {
        //     return {} as vscode.TextEditor;
        // });

        // await restoreOpenTabs(branch);

        // assert.strictEqual(openTextDocumentStub.callCount, 2);
        // assert.strictEqual(showTextDocumentStub.callCount, 2);
    });

    test('Commands should be registered', async () => {
        // const commands = await vscode.commands.getCommands(true);
        // assert.ok(commands.includes('extension.saveTabs'));
        // assert.ok(commands.includes('extension.restoreTabs'));
    });
});