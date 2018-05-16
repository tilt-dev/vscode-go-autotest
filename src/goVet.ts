import path = require('path');
import vscode = require('vscode');
import { getToolsEnvVars, runTool, ICheckResult, getWorkspaceFolderPath, getGoVersion, SemVersion } from './util';
import { outputChannel } from './goStatus';
import { diagnosticsStatusBarItem } from './goStatus';

/**
 * Runs go vet or go tool vet and presents the output in the 'Go' channel and in the diagnostic collections.
 *
 * @param fileUri Document uri.
 * @param goConfig Configuration for the Go extension.
 * @param vetWorkspace If true vets code in all workspace.
 */
export function goVet(fileUri: vscode.Uri, goConfig: vscode.WorkspaceConfiguration, vetWorkspace?: boolean): Promise<ICheckResult[]> {
	if (running) {
		tokenSource.cancel();
	}

	const currentWorkspace = getWorkspaceFolderPath(fileUri);
	const cwd = (vetWorkspace && currentWorkspace) ? currentWorkspace : path.dirname(fileUri.fsPath);
	if (!path.isAbsolute(cwd)) {
		return Promise.resolve([]);
	}

	const vetFlags = goConfig['vetFlags'] || [];
	const vetEnv = Object.assign({}, getToolsEnvVars());
	const vetPromise = getGoVersion().then((version: SemVersion) => {
		const tagsArg = [];
		if (goConfig['buildTags'] && vetFlags.indexOf('-tags') === -1) {
			tagsArg.push('-tags');
			tagsArg.push(goConfig['buildTags']);
		}

		let vetArgs = ['vet', ...vetFlags, ...tagsArg, './...'];
		if (version && version.major === 1 && version.minor <= 9 && vetFlags.length) {
			vetArgs = ['tool', 'vet', ...vetFlags, ...tagsArg, '.'];
		}

		running = true;
		return runTool(
			vetArgs,
			cwd,
			'warning',
			true,
			null,
			vetEnv,
			false,
			tokenSource.token
		).then((result) => {
			running = false;
			return result;
		});
	});

	return vetPromise;
}

let tokenSource = new vscode.CancellationTokenSource();
let running = false;
