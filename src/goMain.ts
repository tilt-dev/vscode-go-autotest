/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import path = require('path');
import { GoCompletionItemProvider } from './goSuggest';
import { GoHoverProvider } from './goExtraInfo';
import { GoDefinitionProvider } from './goDeclaration';
import { GoReferenceProvider } from './goReferences';
import { GoImplementationProvider } from './goImplementations';
import { GoRenameProvider } from './goRename';
import { GoDocumentSymbolProvider } from './goOutline';
import { GoRunTestCodeLensProvider } from './goRunTestCodelens';
import { GoSignatureHelpProvider } from './goSignature';
import { GoWorkspaceSymbolProvider } from './goSymbol';
import { GoCodeActionProvider } from './goCodeAction';
import { check, removeTestStatus, notifyIfGeneratedFile } from './goCheck';
import { updateGoPathGoRootFromConfig, offerToInstallTools } from './goInstallTools';
import { GO_MODE } from './goMode';
import { showHideStatus } from './goStatus';
import { toggleCoverageCurrentPackage, getCodeCoverage, removeCodeCoverage } from './goCover';
import { initGoCover } from './goCover';
import { testAtCursor, testCurrentPackage, testCurrentFile, testPrevious, testWorkspace, setAutorunAtCursor, runAutorunTest, clearAutorunTest } from './goTest';
import { showTestOutput } from './testUtils';
import * as goGenerateTests from './goGenerateTests';
import { addImport } from './goImport';
import { getAllPackages } from './goPackages';
import { installAllTools, checkLanguageServer } from './goInstallTools';
import { isGoPathSet, getBinPath, getExtensionCommands, getGoVersion, getCurrentGoPath, getToolsGopath, handleDiagnosticErrors, disposeTelemetryReporter, getToolsEnvVars } from './util';
import { LanguageClient, RevealOutputChannelOn } from 'vscode-languageclient';
import { clearCacheForTools, fixDriveCasingInWindows } from './goPath';
import { addTags, removeTags } from './goModifytags';
import { runFillStruct } from './goFillStruct';
import { parseLiveFile } from './goLiveErrors';
import { GoReferencesCodeLensProvider } from './goReferencesCodelens';
import { implCursor } from './goImpl';
import { browsePackages } from './goBrowsePackage';
import { goGetPackage } from './goGetPackage';
import { GoDebugConfigurationProvider } from './goDebugConfiguration';
import { playgroundCommand } from './goPlayground';
import { lintCode } from './goLint';
import { vetCode } from './goVet';
import { buildCode } from './goBuild';
import { installCurrentPackage } from './goInstall';

export let errorDiagnosticCollection: vscode.DiagnosticCollection;
export let warningDiagnosticCollection: vscode.DiagnosticCollection;

export function activate(ctx: vscode.ExtensionContext): void {
	initGoCover(ctx);

	let testCodeLensProvider = new GoRunTestCodeLensProvider();
	ctx.subscriptions.push(vscode.languages.registerCodeLensProvider(GO_MODE, testCodeLensProvider));

	errorDiagnosticCollection = vscode.languages.createDiagnosticCollection('go-error');
	ctx.subscriptions.push(errorDiagnosticCollection);
	warningDiagnosticCollection = vscode.languages.createDiagnosticCollection('go-warning');
	ctx.subscriptions.push(warningDiagnosticCollection);

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.autoRunTest', (args) => {
		let goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		let isBenchmark = false;
		setAutorunAtCursor(goConfig, isBenchmark, args);
		testCodeLensProvider.rerenderCodeLenses();
	}));

	ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {
		let updatedGoConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		updateGoPathGoRootFromConfig();

		// If there was a change in "toolsGopath" setting, then clear cache for go tools
		if (getToolsGopath() !== getToolsGopath(false)) {
			clearCacheForTools();
		}

		if (updatedGoConfig['enableCodeLens']) {
			testCodeLensProvider.setEnabled(updatedGoConfig['enableCodeLens']['autoruntest']);
		}

	}));

	vscode.languages.setLanguageConfiguration(GO_MODE.language, {
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
	});

	let watcher = vscode.workspace.createFileSystemWatcher(
		path.join(vscode.workspace.rootPath, '**', '*')
	);
	watcher.onDidChange(runAutorunTest);
	watcher.onDidCreate(runAutorunTest);
	watcher.onDidDelete(runAutorunTest);

	ctx.subscriptions.push(watcher);
	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.clearAutorunTest', () => {
		clearAutorunTest();
		testCodeLensProvider.rerenderCodeLenses();
	}));
}

export function deactivate() {
	return disposeTelemetryReporter();
}

function runBuilds(document: vscode.TextDocument, goConfig: vscode.WorkspaceConfiguration) {
	if (document.languageId !== 'go') {
		return;
	}

	errorDiagnosticCollection.clear();
	warningDiagnosticCollection.clear();
	check(document.uri, goConfig)
		.then((errors) => {
			handleDiagnosticErrors(document, errors);
		})
		.catch(err => {
			vscode.window.showInformationMessage('Error: ' + err);
		});
}

function didLangServerConfigChange(useLangServer: boolean, langServerFlags: string[], newconfig: vscode.WorkspaceConfiguration) {
	let newLangServerFlags = newconfig['languageServerFlags'] || [];
	if (useLangServer !== newconfig['useLanguageServer'] || langServerFlags.length !== newLangServerFlags.length) {
		return true;
	}

	for (let i = 0; i < langServerFlags.length; i++) {
		if (newLangServerFlags[i] !== langServerFlags[i]) {
			return true;
		}
	}
	return false;
}

function loadPackages() {
	getAllPackages();
}
