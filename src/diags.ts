'use strict';

import vscode = require('vscode');

class TestResultDisplay {
	private source: string;
	private collection: vscode.DiagnosticCollection;

	constructor(ctx: vscode.ExtensionContext, source: string) {
		this.source = source;
		this.collection = vscode.languages.createDiagnosticCollection(source);
		ctx.subscriptions.push(this.collection);
	}

	clear() {
		this.collection.clear();
	}

	displaySuccess(fn: vscode.SymbolInformation) {
		this.display(fn, 'ok: ' + fn.name, vscode.DiagnosticSeverity.Information);
	}

	displayFailure(fn: vscode.SymbolInformation) {
		this.display(fn, 'FAIL: ' + fn.name, vscode.DiagnosticSeverity.Error);
	}

	// Unknown indicates an internal analysis error where we didn't find the test results.
	displayUnknown(fn: vscode.SymbolInformation) {
		this.display(fn, 'unknown: ' + fn.name, vscode.DiagnosticSeverity.Error);
	}

	displayWaiting(fn: vscode.SymbolInformation) {
		this.display(fn, 'waiting: ' + fn.name, vscode.DiagnosticSeverity.Information);
	}

	private display(fn: vscode.SymbolInformation, message: string, severity: vscode.DiagnosticSeverity) {
		let uri = fn.location.uri;

		// Only highlight the first line of the function.
		let range = new vscode.Range(
			fn.location.range.start,
			new vscode.Position(fn.location.range.start.line, 1000));
		let d = new vscode.Diagnostic(range, message, severity);
		d.source = this.source;

		let oldDiags = this.collection.get(uri) || [];
		let newDiags = [].concat(oldDiags);
		newDiags.push(d);
		this.collection.set(uri, newDiags);
	}
}
export let pinDisplay: TestResultDisplay;
export let autotestDisplay: TestResultDisplay;

export function initDiagnosticCollection(ctx: vscode.ExtensionContext) {
	pinDisplay = new TestResultDisplay(ctx, 'pinned');
	autotestDisplay = new TestResultDisplay(ctx, 'wm-autotest');
}
