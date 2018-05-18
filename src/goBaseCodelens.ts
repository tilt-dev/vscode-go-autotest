
import vscode = require('vscode');

export abstract class GoBaseCodeLensProvider implements vscode.CodeLensProvider {
	protected enabled: boolean = true;
	protected onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();


	public get onDidChangeCodeLenses(): vscode.Event<void> {
		return this.onDidChangeCodeLensesEmitter.event;
	}

	public setEnabled(enabled: false): void {
		if (this.enabled !== enabled) {
			this.enabled = enabled;
			this.onDidChangeCodeLensesEmitter.fire();
		}
	}

	public rerenderCodeLenses() {
		this.onDidChangeCodeLensesEmitter.fire();
	}

	provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
		return [];
	}

}

let codeLens: GoBaseCodeLensProvider;

export function setDefaultCodeLens(cl: GoBaseCodeLensProvider) {
	codeLens = cl;
}

export function rerenderCodeLenses() {
	if (codeLens) {
		codeLens.rerenderCodeLenses();
	}
}