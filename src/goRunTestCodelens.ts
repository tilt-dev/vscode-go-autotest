/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import path = require('path');
import { TextDocument, CancellationToken, CodeLens, Command } from 'vscode';
import { getTestFunctions, getBenchmarkFunctions, getTestFlags } from './testUtils';
import { getCurrentGoPath } from './util';
import { GoBaseCodeLensProvider } from './goBaseCodelens';
import { currentAutorunTestConfig, getLastAutorunTestResult } from './goTest';

export class GoRunTestCodeLensProvider extends GoBaseCodeLensProvider {
	public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
		if (!this.enabled) {
			return [];
		}
		let config = vscode.workspace.getConfiguration('go', document.uri);
		let codeLensConfig = config.get('enableCodeLens');
		let codelensEnabled = codeLensConfig ? codeLensConfig['runtest'] : false;
		if (!codelensEnabled || !document.fileName.endsWith('_test.go')) {
			return [];
		}

		return this.getCodeLensForFunctions(config, document, token);
	}

	private getCodeLensForFunctions(vsConfig: vscode.WorkspaceConfiguration, document: TextDocument, token: CancellationToken): Thenable<CodeLens[]> {
		const codelens: CodeLens[] = [];

		const testPromise = getTestFunctions(document, token).then(testFunctions => {
			let testResult = getLastAutorunTestResult();
			testFunctions.forEach(func => {

				let autorun = currentAutorunTestConfig();
				if (autorun && autorun.functions &&
					autorun.functions.findIndex((f: vscode.SymbolInformation) => f.name === func.name) !== -1) {

					codelens.push(new CodeLens(func.location.range, {
						title: 'remove pin',
						command: 'go.autotest.clear'
					}));

					if (testResult && (func.name in testResult.tests)) {
						let success = testResult.tests[func.name];
						let title = success ? 'output (ok)' : 'output (FAIL)';
						codelens.push(new CodeLens(func.location.range, {
							title: title,
							command: 'go.autotest.show',
							arguments: [{ success }],
						}));
					}
				} else {
					codelens.push(new CodeLens(func.location.range, {
						title: 'pin test',
						command: 'go.autotest.pin',
						arguments: [{ symbol: func }]
					}));
					codelens.push(new CodeLens(func.location.range, {
						title: 'show file autotest output',
						command: 'go.autotest.showFile'
					}));
				}
			});
		});

		return testPromise.then(() => codelens);
	}
}
