/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath, getToolsEnvVars, killProcess } from './util';
import { getGoRuntimePath } from './goPath';
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';

// Keep in sync with github.com/acroca/go-symbols'
interface GoSymbolDeclaration {
	name: string;
	kind: string;
	package: string;
	path: string;
	line: number;
	character: number;
}

export function getWorkspaceSymbols(workspacePath: string, query: string, token: vscode.CancellationToken, goConfig?: vscode.WorkspaceConfiguration, ignoreFolderFeatureOn: boolean = true): Thenable<GoSymbolDeclaration[]> {
	if (!goConfig) {
		goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
	}
	let gotoSymbolConfig = goConfig['gotoSymbol'];
	let calls: Promise<GoSymbolDeclaration[]>[] = [];

	let ignoreFolders: string[] = gotoSymbolConfig ? gotoSymbolConfig['ignoreFolders'] : [];
	let baseArgs = (ignoreFolderFeatureOn && ignoreFolders && ignoreFolders.length > 0) ? ['-ignore', ignoreFolders.join(',')] : [];

	calls.push(callGoSymbols([...baseArgs, workspacePath, query], token));

	if (gotoSymbolConfig.includeGoroot) {
		let gorootCall = getGoroot()
			.then(goRoot => callGoSymbols([...baseArgs, goRoot, query], token));
		calls.push(gorootCall);
	}

	return Promise.all(calls)
		.then(([...results]) => <GoSymbolDeclaration[]>[].concat(...results))
		.catch((err: Error) => {
			if (err && (<any>err).code === 'ENOENT') {
				promptForMissingTool('go-symbols');
			}
			if (err.message.startsWith('flag provided but not defined: -ignore')) {
				promptForUpdatingTool('go-symbols');
				return getWorkspaceSymbols(workspacePath, query, token, goConfig, false);
			}
		});
}

function callGoSymbols(args: string[], token: vscode.CancellationToken): Promise<GoSymbolDeclaration[]> {
	let gosyms = getBinPath('go-symbols');
	let env = getToolsEnvVars();
	let p: cp.ChildProcess;

	if (token) {
		token.onCancellationRequested(() => killProcess(p));
	}

	return new Promise((resolve, reject) => {
		p = cp.execFile(gosyms, args, { maxBuffer: 1024 * 1024, env }, (err, stdout, stderr) => {
			if (err && stderr && stderr.startsWith('flag provided but not defined: -ignore')) {
				return reject(new Error(stderr));
			} else if (err) {
				return reject(err);
			}
			let result = stdout.toString();
			let decls = <GoSymbolDeclaration[]>JSON.parse(result);
			return resolve(decls);
		});
	});
}

function getGoroot(): Promise<string> {
	let goExecutable = getGoRuntimePath();
	if (!goExecutable) {
		return Promise.reject(new Error('Cannot find "go" binary. Update PATH or GOROOT appropriately'));
	}
	return new Promise((resolve, reject) => {
		cp.execFile(goExecutable, ['env', 'GOROOT'], (err, stdout) => {
			if (err) {
				reject(err);
				return;
			}
			let [goRoot] = stdout.split('\n');
			resolve(goRoot.trim());
		});
	});
}

