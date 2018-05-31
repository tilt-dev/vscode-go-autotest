/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import path = require('path');
import vscode = require('vscode');
import os = require('os');
import { goTest, TestConfig, getTestFlags, getTestFunctions, getBenchmarkFunctions, TestResult  } from './testUtils';
import { sendTelemetryEvent } from './util';
import { pinDisplay, autotestDisplay } from './diags';
import { outputChannel } from './goStatus';
import { rerenderCodeLenses } from './goBaseCodelens';
import { removeCodeCoverage, clearCoverage, coverProfilePath, clearCoverProfilePath, setCoverProfilePath, reanalyzeCoverage } from './goCover';

let autorunTestConfig: TestConfig;
let lastAutorunTestResult: TestResult;
let autorunTestStart: number;

let autotestFileConfig: TestConfig;
let lastAutotestFileResult: TestResult;

// Returns a promise that completes when the configuration is set.
export function pinTestAtCursor(goConfig: vscode.WorkspaceConfiguration, isBenchmark: boolean, args: any): Thenable<any> {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return Promise.resolve(true);
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		vscode.window.showInformationMessage('No tests found. Current file is not a test file.');
		return Promise.resolve(true);
	}

	cleanUpOldAutotestFileOutput();
	autotestDisplay.clear();
	clearPinnedTest();
	sendTelemetryEvent('autotest-pin', { args }, {});

	const getFunctions = isBenchmark ? getBenchmarkFunctions : getTestFunctions;

	const testFlags = getTestFlags(goConfig, args) || [];

	// TODO(nick): By default, this only runs coverage for the current package.
	// If this is a useful feature, we might make it run coverage for the package
	// you're currently editing as well.
	let coverPath = path.normalize(path.join(os.tmpdir(), 'go-code-cover'));
	testFlags.push('-coverprofile=' + coverPath);
	setCoverProfilePath(coverPath);

	return editor.document.save().then(() => {
		return getFunctions(editor.document, null);
	}).then(testFunctions => {
		let testFunction: vscode.SymbolInformation;

		// We use symbol if it was provided as argument
		// Otherwise find any test function containing the cursor.
		if (args && args.symbol) {
			testFunction = args.symbol;
		} else {
			for (let func of testFunctions) {
				let selection = editor.selection;
				if (selection && func.location.range.contains(selection.start)) {
					testFunction = func;
					break;
				}
			};
		}

		if (!testFunction) {
			vscode.window.showInformationMessage('No test function found at cursor.');
			return;
		}

		const testConfig = {
			goConfig: goConfig,
			dir: path.dirname(editor.document.fileName),
			fileName: editor.document.fileName,
			flags: testFlags,
			functions: [testFunction],
			isBenchmark: isBenchmark,
			showTestCoverage: true,
			background: true,
			output: vscode.window.createOutputChannel('Go Test ' + testFunction.name),
		};

		// Remember this config as the autorun test
		autorunTestConfig = testConfig;

		// add some ui for the currently running test
		updatePinStatus();
		pinDisplay.displayWaiting(testFunction);

		// focus the problems pane so that we see the new testConfig
		vscode.commands.executeCommand('workbench.action.problems.focus');
		rerenderCodeLenses();

		// fire and forget the test
		runPinnedTest();
	});
}

let pinStatus: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
function updatePinStatus() {
	if (autorunTestConfig) {
		let result = getLastAutorunTestResult();
		let fnName = autorunTestConfig.functions[0].name;
		if (result) {
			pinStatus.text = 'Autotest (' + (result.success ? 'ok' : 'FAIL') + '): ' + fnName;
			if (result.success) {
				pinStatus.color = '';
			} else {
				pinStatus.color = new vscode.ThemeColor('errorForeground');
			}
		} else {
			pinStatus.text = 'Autotest: ' + fnName;
			pinStatus.color = '';
		}
		pinStatus.command = 'go.autotest.show';
		pinStatus.show();
	} else {
		pinStatus.hide();
	}
}

export function maybeAutorunTestsOnChange(): Thenable<void> {
	// If there's a pinned test, run that now.
	if (autorunTestConfig) {
		return runPinnedTest();
	}

	// Otherwise, clear any existing autotests.  We don't want to autotest on
	// every save because that makes the edit experience laggy on large files.
	cleanUpOldAutotestFileOutput();
	autotestDisplay.clear();
	return Promise.resolve();
}

function log(msg: string) {
	console.log(new Date().toLocaleTimeString() + ' ' + msg);
}

function runPinnedTest(): Thenable<void> {
	if (!autorunTestConfig) {
		return Promise.resolve();
	}
	let fnName = autorunTestConfig.functions[0].name;
	log('Running pinned test ' + fnName);
	return goTest(autorunTestConfig).then((result) => {
		log('[done] running pinned test ' + fnName);
		lastAutorunTestResult = result;
		pinDisplay.clear();

		// If the buildFailed, we still show the pinned results
		// as failures, because the user expects them to be pinned.
		for (let fn of autorunTestConfig.functions) {
			if (!(fn.name in result.tests)) {
				pinDisplay.displayUnknown(fn);
			} else if (result.tests[fn.name]) {
				pinDisplay.displaySuccess(fn);
			} else {
				pinDisplay.displayFailure(fn);
			}
		}

		updatePinStatus();
	}).then(() => {
		rerenderCodeLenses();
		reanalyzeCoverage();
	}, err => {
		console.error(err);
	});
}

export function showAutorunTest(args) {
	if (!autorunTestConfig) {
		return;
	}

	let success = args && args.success;
	sendTelemetryEvent('autotest-showPin', {success: success}, {});
	autorunTestConfig.output.show(true);
}

export function clearPinnedTest() {
	if (!autorunTestConfig) {
		return;
	}

	let timeTaken = Date.now() - autorunTestStart;
	sendTelemetryEvent('autotest-clearPin', {}, { timeTaken });
	autorunTestStart = 0;
	autorunTestConfig.output.dispose();
	autorunTestConfig = null;
	lastAutorunTestResult = null;
	updatePinStatus();
	pinDisplay.clear();
	rerenderCodeLenses();
	clearCoverage();
	clearCoverProfilePath();
}

export function currentAutorunTestConfig(): TestConfig {
	return autorunTestConfig;
}

export function getLastAutorunTestResult(): TestResult {
	return lastAutorunTestResult;
}

export function getLastAutotestFileResult(): TestResult {
	return lastAutotestFileResult;
}

export function showAutotestFileOutput(args) {
	if (!autotestFileConfig) {
		return;
	}

	sendTelemetryEvent('autotestFileOutput-show', {success: args.success}, {});
	autotestFileConfig.output.show(true);
}

function isTestFileActive(): boolean {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		return false;
	}
	return editor.document.fileName.endsWith('_test.go');
}

export function maybeAutotestCurrentFile(): Thenable<void> {
	let oldFileName = autotestFileConfig && autotestFileConfig.fileName;
	cleanUpOldAutotestFileOutput();

	// Don't do this if a test is already pinned.
	if (autorunTestConfig) {
		autotestDisplay.clear();
		return Promise.resolve();
	}

	if (!isTestFileActive()) {
		autotestDisplay.clear();
		return Promise.resolve();
	}

	let editor = vscode.window.activeTextEditor;
	let goConfig = vscode.workspace.getConfiguration('go', editor ? editor.document.uri : null);
	let output = vscode.window.createOutputChannel('Go Test ' + editor.document.fileName);

	let fileName = editor.document.fileName;
	let dir = path.dirname(fileName);
	if (oldFileName !== fileName) {
		autotestDisplay.clear();
	}

	return getTestFunctions(editor.document, null).then(testFunctions => {
		const testConfig = {
			goConfig: goConfig,
			dir: dir,
			fileName: fileName,
			flags: getTestFlags(goConfig, []),
			functions: testFunctions,
			background: true,
			output: output,
		};
		autotestFileConfig = testConfig;

		log('Autotesting file ' + fileName);
		return Promise.all([goTest(testConfig), testFunctions]);
	}).then((resultArray) => {
		log('[done] autotesting file ' + fileName);
		autotestDisplay.clear();

		let [result, testFunctions] = resultArray;
		lastAutotestFileResult = result;

		// Don't show failure diagnostics on all tests if they failed
		// to build. It's just noise.
		if (result.buildFailed) {
			return;
		}

		for (let fn of testFunctions) {
			if (result.tests[fn.name] === false) {
				autotestDisplay.displayFailure(fn);
			}
		}
	}).then(() => {
		rerenderCodeLenses();
	}, (err) => {
		console.error(err);
		return Promise.resolve(false);
	});
}

export function cleanUpOldAutotestFileOutput() {
	if (autotestFileConfig && autotestFileConfig.output) {
		autotestFileConfig.output.dispose();
		autotestFileConfig = null;
		lastAutotestFileResult = null;
	}
}

export function updatePinnedTestLocation(u: vscode.Uri) {
	if (autorunTestConfig && autorunTestConfig.fileName === u.path) {
		// Get all testFunctions from that file
		vscode.workspace.openTextDocument(autorunTestConfig.fileName).then((document): Thenable<vscode.SymbolInformation[]> => {
			return getTestFunctions(document, null);
		}).then(testFunctions => {
			for (let func of testFunctions) {
				if (func.name === autorunTestConfig.functions[0].name) {
					autorunTestConfig.functions[0].location = func.location;
					return;
				}
			}
			// if we didn't find the test in this file, assume it was deleted
			clearPinnedTest();
		});

		rerenderCodeLenses();
	}
}
