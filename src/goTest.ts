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

let autorunTestConfig: TestConfig;
let lastAutorunTestResult: TestResult;
let autorunTestStart: number;

let autotestFileConfig: TestConfig;
let lastAutotestFileResult: TestResult;

// Returns a promise that completes when the configuration is set.
export function setAutorunAtCursor(goConfig: vscode.WorkspaceConfiguration, isBenchmark: boolean, args: any): Thenable<any> {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return Promise.resolve(true);
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		vscode.window.showInformationMessage('No tests found. Current file is not a test file.');
		return Promise.resolve(true);
	}

	clearAutorunTest();
	sendTelemetryEvent('autorunTest', { args }, {});

	const getFunctions = isBenchmark ? getBenchmarkFunctions : getTestFunctions;

	const testFlags = getTestFlags(goConfig, args) || [];

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
		updateAutorunStatus();
		pinDisplay.displayWaiting(testFunction);

		// focus the problems pane so that we see the new testConfig
		vscode.commands.executeCommand('workbench.action.problems.focus');
		rerenderCodeLenses();

		// fire and forget the test
		runAutorunTest();
	});
}

let autorunStatus: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
function updateAutorunStatus() {
	if (autorunTestConfig) {
		autorunStatus.text = 'Autotest: ' + autorunTestConfig.functions[0].name;
		autorunStatus.command = 'go.autotest.show';
		autorunStatus.show();
	} else {
		autorunStatus.hide();
	}
}

export function runAutorunTest(): Thenable<void> {
	if (!autorunTestConfig) {
		return Promise.resolve();
	}
	return goTest(autorunTestConfig).then((result) => {
		lastAutorunTestResult = result;
		pinDisplay.clear();

		for (let fn of autorunTestConfig.functions) {
			if (!(fn.name in result.tests)) {
				pinDisplay.displayUnknown(fn);
			} else if (result.tests[fn.name]) {
				pinDisplay.displaySuccess(fn);
			} else {
				pinDisplay.displayFailure(fn);
			}
		}

		rerenderCodeLenses();
	}).then(null, err => {
		console.error(err);
	});
}

export function showAutorunTest(args) {
	if (!autorunTestConfig) {
		return;
	}

	sendTelemetryEvent('autorunTest-show', {success: args.success}, {});
	autorunTestConfig.output.show(true);
}

export function clearAutorunTest() {
	if (!autorunTestConfig) {
		return;
	}

	let timeTaken = Date.now() - autorunTestStart;
	sendTelemetryEvent('autorunTest-clear', {}, { timeTaken });
	autorunTestStart = 0;
	autorunTestConfig.output.dispose();
	autorunTestConfig = null;
	lastAutorunTestResult = null;
	updateAutorunStatus();
	pinDisplay.clear();
	rerenderCodeLenses();
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

export function testCurrentFileSilently(goConfig: vscode.WorkspaceConfiguration, args: string[]): Thenable<void> {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		return;
	}

	// Don't do this if a test is already pinned.
	if (autorunTestConfig) {
		return;
	}

	let output = vscode.window.createOutputChannel('Go Test ' + editor.document.fileName);

	return getTestFunctions(editor.document, null).then(testFunctions => {
		const testConfig = {
			goConfig: goConfig,
			dir: path.dirname(editor.document.fileName),
			flags: getTestFlags(goConfig, args),
			functions: testFunctions,
			background: true,
			output: output,
		};
		autotestFileConfig = testConfig;
		return Promise.all([goTest(testConfig), testFunctions]);
	}).then((resultArray) => {
		autotestDisplay.clear();

		let [result, testFunctions] = resultArray;
		lastAutotestFileResult = result;
		for (let fn of testFunctions) {
			if (result.tests[fn.name] === false) {
				autotestDisplay.displayFailure(fn);
			}
		}
		rerenderCodeLenses();
	}).then(() => {
		// this space intentionally left blank
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
