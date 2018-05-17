/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import path = require('path');
import vscode = require('vscode');
import os = require('os');
import { goTest, TestConfig, getTestFlags, getTestFunctions, getBenchmarkFunctions  } from './testUtils';
import { sendTelemetryEvent } from './util';
import { testDiagnosticCollection } from './diags';
import { outputChannel } from './goStatus';

let autorunTestConfig: TestConfig;
let autorunTestStart: number;

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
		setAutorunDiagnostic(testFunction, 'WAITING: ' + testFunction.name, vscode.DiagnosticSeverity.Information, 'pinned');

		// focus the problems pane so that we see the new testConfig
		vscode.commands.executeCommand('workbench.action.problems.focus');

		// fire and forget the test
		runAutorunTest();
	});
}

let autorunStatus: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
function updateAutorunStatus() {
	if (autorunTestConfig) {
		autorunStatus.text = 'Autorun: ' + autorunTestConfig.functions[0].name;
		autorunStatus.command = 'go.test.showAutorunTest';
		autorunStatus.show();
	} else {
		autorunStatus.hide();
	}
}

function setAutorunDiagnostic(fn: vscode.SymbolInformation, message: string, severity: vscode.DiagnosticSeverity, source: string) {
	// Send diagnostic information about the test to the problems panel.
	let uri = fn.location.uri;
	testDiagnosticCollection.delete(uri);

	// Only highlight the first line of the function.
	let range = new vscode.Range(
		fn.location.range.start,
		new vscode.Position(fn.location.range.start.line, 1000));
	let d = new vscode.Diagnostic(range, message, severity);
	d.source = source;
	testDiagnosticCollection.set(uri, [d]);
}

export function runAutorunTest() {
	if (!autorunTestConfig) {
		return;
	}
	return goTest(autorunTestConfig).then((result) => {
		for (let fn of autorunTestConfig.functions) {
			if (!(fn.name in result.tests)) {
				setAutorunDiagnostic(fn, 'unknown: ' + fn.name, vscode.DiagnosticSeverity.Information, 'pinned');
			} else if (result.tests[fn.name]) {
				setAutorunDiagnostic(fn, 'SUCCESS: ' + fn.name, vscode.DiagnosticSeverity.Information, 'pinned');
			} else {
				setAutorunDiagnostic(fn, 'FAILED: ' + fn.name, vscode.DiagnosticSeverity.Error, 'pinned');
			}
		}
	}).then(null, err => {
		console.error(err);
	});
}

export function showAutorunTest(args) {
	if (!autorunTestConfig) {
		return;
	}

	sendTelemetryEvent('autorunTest-show', {}, {});
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
	updateAutorunStatus();
	testDiagnosticCollection.clear();
}

export function currentAutorunTestConfig(): TestConfig {
	return autorunTestConfig;
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
		return Promise.all([goTest(testConfig), testFunctions]);
	}).then((resultArray) => {
		let [result, testFunctions] = resultArray;
		for (let fn of testFunctions) {
			if (result.tests[fn.name] === false) {
				setAutorunDiagnostic(fn, 'FAILED: ' + fn.name, vscode.DiagnosticSeverity.Error, 'wm-autorun');
			}
		}
	}).then(() => {
		output.dispose();
	}, (err) => {
		output.dispose();
		console.error(err);
		return Promise.resolve(false);
	});
}
