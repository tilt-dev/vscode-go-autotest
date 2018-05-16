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
		return getFunctions(editor.document, null).then(testFunctions => {
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
				showTestCoverage: true
			};

			// Remember this config as the autorun test
			autorunTestConfig = testConfig;
			updateAutorunStatus();

			return goTest(testConfig);
		});
	}).then(success => {
		if (success && tmpCoverPath) {
			return getCoverage(tmpCoverPath);
		}
	}, err => {
		console.error(err);
	});
}

let autorunStatus: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
function updateAutorunStatus() {
	if (autorunTestConfig) {
		autorunStatus.text = 'Autorun: ' + autorunTestConfig.functions[0];
		autorunStatus.show();
	} else {
		autorunStatus.hide();
	}
}

export function runAutorunTest() {
	if (!autorunTestConfig) {
		return;
	}
	goTest(autorunTestConfig).then(null, err => {
		console.error(err);
	});
}

export function clearAutorunTest() {
	if (autorunTestConfig) {
		let timeTaken = Date.now() - autorunTestStart;
		sendTelemetryEvent('autorunTest-clear', {}, { timeTaken });
		autorunTestStart = 0;
		autorunTestConfig = null;
		updateAutorunStatus();
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
