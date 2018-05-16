/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import path = require('path');
import _ = require('lodash');
import { GoDocumentSymbolProvider } from './goOutline';
import { GoRunTestCodeLensProvider } from './goRunTestCodelens';
import { GoWorkspaceSymbolProvider } from './goSymbol';
import { updateGoPathGoRootFromConfig, offerToInstallTools } from './goInstallTools';
import { GO_MODE } from './goMode';
import { showHideStatus } from './goStatus';
import { setAutorunAtCursor, runAutorunTest, clearAutorunTest, showAutorunTest,  testCurrentFileSilently } from './goTest';
import { getAllPackages } from './goPackages';
import { installAllTools, checkLanguageServer } from './goInstallTools';
import { isGoPathSet, getBinPath, getExtensionCommands, getGoVersion, getCurrentGoPath, getToolsGopath, disposeTelemetryReporter, getToolsEnvVars } from './util';
import { LanguageClient, RevealOutputChannelOn } from 'vscode-languageclient';
import { clearCacheForTools, fixDriveCasingInWindows } from './goPath';
import { implCursor } from './goImpl';
import { installCurrentPackage } from './goInstall';
import { initDiagnosticCollection } from './diags';

export function activate(ctx: vscode.ExtensionContext): void {
	initDiagnosticCollection(ctx);

	let testCodeLensProvider = new GoRunTestCodeLensProvider();
	ctx.subscriptions.push(vscode.languages.registerCodeLensProvider(GO_MODE, testCodeLensProvider));

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

  // Only watch Go files. The vscode filesystem watcher does
  // not support more complex matching patterns, otherwise we'd use
  // a narrower filter that skipped gitignore files.
	let watcher = vscode.workspace.createFileSystemWatcher(
		path.join(vscode.workspace.rootPath, '**', '*.go')
	);

	let onChange = _.debounce(runAutorunTest, 200);
	watcher.onDidChange(onChange);
	watcher.onDidCreate(onChange);
	watcher.onDidDelete(onChange);

	ctx.subscriptions.push(watcher);

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.autorunTest', (args) => {
		let goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		setAutorunAtCursor(goConfig, false, args).then(() => {
		  testCodeLensProvider.rerenderCodeLenses();
		});
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.clearAutorunTest', () => {
		clearAutorunTest();
		testCodeLensProvider.rerenderCodeLenses();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.showAutorunTest', showAutorunTest));
	vscode.window.onDidChangeActiveTextEditor(cachePackageTests);
}

export function deactivate() {
	return disposeTelemetryReporter();
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

function cachePackageTests(v: vscode.TextEditor) {
	let goConfig = vscode.workspace.getConfiguration('go', v ? v.document.uri : null);

	testCurrentFileSilently(goConfig, []);
}

