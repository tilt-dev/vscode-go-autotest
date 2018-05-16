/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import path = require('path');
import vscode = require('vscode');
import os = require('os');
import { goTest, TestConfig, getTestFlags, getTestFunctions, getBenchmarkFunctions } from './testUtils';
import { getCoverage } from './goCover';
import { sendTelemetryEvent } from './util';
import { testDiagnosticCollection } from './diags';

let autorunTestConfig: TestConfig;
let autorunTestStart: number;

export function setAutorunAtCursor(goConfig: vscode.WorkspaceConfiguration, isBenchmark: boolean, args: any) {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		vscode.window.showInformationMessage('No tests found. Current file is not a test file.');
		return;
	}

	clearAutorunTest();
	sendTelemetryEvent('autorunTest', { args }, {});

	const getFunctions = isBenchmark ? getBenchmarkFunctions : getTestFunctions;

	const {tmpCoverPath, testFlags } = makeCoverData(goConfig, 'coverOnSingleTest', args);

	editor.document.save().then(() => {
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
			coverPath: tmpCoverPath,
			functions: [testFunction],
			isBenchmark: isBenchmark,
			showTestCoverage: true,
			background: true,
			output: vscode.window.createOutputChannel('Go Test ' + testFunction.name),
		};

		// Remember this config as the autorun test
		autorunTestConfig = testConfig;
		updateAutorunStatus();

		return runAutorunTest();
	});
}

let autorunStatus: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
function updateAutorunStatus() {
	if (autorunTestConfig) {
		autorunStatus.text = 'Autorun: ' + autorunTestConfig.functions[0].name;
		autorunStatus.show();
	} else {
		autorunStatus.hide();
	}
}

export function runAutorunTest() {
	if (!autorunTestConfig) {
		return;
	}
	return goTest(autorunTestConfig).then((success) => {
		let testFunction = autorunTestConfig.functions[0];

		// Send diagnostic information about the test to the problems panel.
		let uri = testFunction.location.uri;
		testDiagnosticCollection.delete(uri);

		// Only highlight the first line of the function.
		let range = new vscode.Range(
			testFunction.location.range.start,
			new vscode.Position(testFunction.location.range.start.line, 1000));
		if (success) {
			testDiagnosticCollection.set(uri, [
				new vscode.Diagnostic(range, 'SUCCESS: ' + testFunction.name, vscode.DiagnosticSeverity.Information)
			]);
		} else {
			testDiagnosticCollection.set(uri, [
				new vscode.Diagnostic(range, 'FAILED: ' + testFunction.name, vscode.DiagnosticSeverity.Error)
			]);
		}

		let coverPath = autorunTestConfig.coverPath;
		if (success && coverPath) {
			return getCoverage(coverPath);
		}
	}).then(null, err => {
		console.error(err);
	});
}

export function clearAutorunTest() {
	if (autorunTestConfig) {
		let timeTaken = Date.now() - autorunTestStart;
		sendTelemetryEvent('autorunTest-clear', {}, { timeTaken });
		autorunTestStart = 0;
		autorunTestConfig.output.dispose();
		autorunTestConfig = null;
		updateAutorunStatus();
		testDiagnosticCollection.clear();
	}
}

export function currentAutorunTestConfig(): TestConfig {
	return autorunTestConfig;
}

/**
 * Computes the tmp coverage path and needed flags.
 *
 * @param goConfig Configuration for the Go extension.
 */
function makeCoverData(goConfig: vscode.WorkspaceConfiguration, confFlag: string, args: any): { tmpCoverPath: string, testFlags: string[] } {
	let tmpCoverPath = '';
	let testFlags = getTestFlags(goConfig, args) || [];
	if (goConfig[confFlag] === true) {
		tmpCoverPath = path.normalize(path.join(os.tmpdir(), 'go-code-cover'));
		testFlags.push('-coverprofile=' + tmpCoverPath);
	}

	return {tmpCoverPath, testFlags};
}
