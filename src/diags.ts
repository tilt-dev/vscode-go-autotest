'use strict';

import vscode = require('vscode');

export let testDiagnosticCollection: vscode.DiagnosticCollection;

export function initDiagnosticCollection(ctx: vscode.ExtensionContext) {
	testDiagnosticCollection = vscode.languages.createDiagnosticCollection('go-test');
	ctx.subscriptions.push(testDiagnosticCollection);
}