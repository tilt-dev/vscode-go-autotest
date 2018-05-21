/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import path = require('path');
import _ = require('lodash');
import { GoRunTestCodeLensProvider } from './goRunTestCodelens';
import { updateGoPathGoRootFromConfig, offerToInstallTools } from './goInstallTools';
import { GO_MODE } from './goMode';
import { showHideStatus } from './goStatus';
import { clearPinnedTest, showAutorunTest, showAutotestFileOutput, maybeAutorunTestsOnChange, maybeAutotestCurrentFile, pinTestAtCursor } from './goTest';
import { getAllPackages } from './goPackages';
import { installAllTools, checkLanguageServer } from './goInstallTools';
import { isGoPathSet, getBinPath, getExtensionCommands, getGoVersion, getCurrentGoPath, getToolsGopath, disposeTelemetryReporter, getToolsEnvVars } from './util';
import { clearCacheForTools, fixDriveCasingInWindows } from './goPath';
import { implCursor } from './goImpl';
import { initDiagnosticCollection, autotestDisplay } from './diags';
import { setDefaultCodeLens } from './goBaseCodelens';

export function activate(ctx: vscode.ExtensionContext): void {
	initDiagnosticCollection(ctx);

	let testCodeLensProvider = new GoRunTestCodeLensProvider();
	ctx.subscriptions.push(vscode.languages.registerCodeLensProvider(GO_MODE, testCodeLensProvider));
	setDefaultCodeLens(testCodeLensProvider);

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

	let onChange = _.debounce(maybeAutorunTestsOnChange, 200);
	watcher.onDidChange(onChange);
	watcher.onDidCreate(onChange);
	watcher.onDidDelete(onChange);

	ctx.subscriptions.push(watcher);

	ctx.subscriptions.push(vscode.commands.registerCommand('go.autotest.pin', (args) => {
		let goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		pinTestAtCursor(goConfig, false, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.autotest.clear', clearPinnedTest));
	ctx.subscriptions.push(vscode.commands.registerCommand('go.autotest.show', showAutorunTest));
	ctx.subscriptions.push(vscode.commands.registerCommand('go.autotest.showFile', showAutotestFileOutput));

	// Automatically run the tests if:
	// 1) There's a test file open when the extension activates, or
	// 2) The user changes the active text editor to a test file.
	ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(maybeAutotestCurrentFile));
	maybeAutotestCurrentFile();
}

export function deactivate() {
	return disposeTelemetryReporter();
}

