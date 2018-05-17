/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import cp = require('child_process');
import jsDiff = require('diff');
import { getBinPath, getGoVersion, isVendorSupported } from '../src/util';
import { documentSymbols } from '../src/goOutline';
import { getAllPackages } from '../src/goPackages';
import { getImportPath } from '../src/util';
import { print } from 'util';

suite('Go Extension Tests', () => {
	let gopath = process.env['GOPATH'];
	if (!gopath) {
		assert.ok(gopath, 'Cannot run tests if GOPATH is not set as environment variable');
		return;
	}

	let repoPath = path.join(gopath, 'src', 'test');
	let fixturePath = path.join(repoPath, 'testfixture');
	let fixtureSourcePath = path.join(__dirname, '..', '..', 'test', 'fixtures');
	let generateTestsSourcePath = path.join(repoPath, 'generatetests');
	let generateFunctionTestSourcePath = path.join(repoPath, 'generatefunctiontest');
	let generatePackageTestSourcePath = path.join(repoPath, 'generatePackagetest');
	let testPath = path.join(__dirname, 'tests');

	suiteSetup(() => {

		fs.removeSync(repoPath);
		fs.removeSync(testPath);
		fs.copySync(path.join(fixtureSourcePath, 'test.go'), path.join(fixturePath, 'test.go'));
		fs.copySync(path.join(fixtureSourcePath, 'errorsTest', 'errors.go'), path.join(fixturePath, 'errorsTest', 'errors.go'));
		fs.copySync(path.join(fixtureSourcePath, 'sample_test.go'), path.join(fixturePath, 'sample_test.go'));
		fs.copySync(path.join(fixtureSourcePath, 'gogetdocTestData', 'test.go'), path.join(fixturePath, 'gogetdocTestData', 'test.go'));
		fs.copySync(path.join(fixtureSourcePath, 'generatetests', 'generatetests.go'), path.join(generateTestsSourcePath, 'generatetests.go'));
		fs.copySync(path.join(fixtureSourcePath, 'generatetests', 'generatetests.go'), path.join(generateFunctionTestSourcePath, 'generatetests.go'));
		fs.copySync(path.join(fixtureSourcePath, 'generatetests', 'generatetests.go'), path.join(generatePackageTestSourcePath, 'generatetests.go'));
		fs.copySync(path.join(fixtureSourcePath, 'diffTestData', 'file1.go'), path.join(fixturePath, 'diffTest1Data', 'file1.go'));
		fs.copySync(path.join(fixtureSourcePath, 'diffTestData', 'file2.go'), path.join(fixturePath, 'diffTest1Data', 'file2.go'));
		fs.copySync(path.join(fixtureSourcePath, 'diffTestData', 'file1.go'), path.join(fixturePath, 'diffTest2Data', 'file1.go'));
		fs.copySync(path.join(fixtureSourcePath, 'diffTestData', 'file2.go'), path.join(fixturePath, 'diffTest2Data', 'file2.go'));
		fs.copySync(path.join(fixtureSourcePath, 'linterTest', 'linter_1.go'), path.join(fixturePath, 'linterTest', 'linter_1.go'));
		fs.copySync(path.join(fixtureSourcePath, 'linterTest', 'linter_2.go'), path.join(fixturePath, 'linterTest', 'linter_2.go'));
		fs.copySync(path.join(fixtureSourcePath, 'errorsTest', 'errors.go'), path.join(testPath, 'errorsTest', 'errors.go'));
		fs.copySync(path.join(fixtureSourcePath, 'linterTest', 'linter_1.go'), path.join(testPath, 'linterTest', 'linter_1.go'));
		fs.copySync(path.join(fixtureSourcePath, 'linterTest', 'linter_2.go'), path.join(testPath, 'linterTest', 'linter_2.go'));
		fs.copySync(path.join(fixtureSourcePath, 'buildTags', 'hello.go'), path.join(fixturePath, 'buildTags', 'hello.go'));
		fs.copySync(path.join(fixtureSourcePath, 'completions', 'unimportedPkgs.go'), path.join(fixturePath, 'completions', 'unimportedPkgs.go'));
		fs.copySync(path.join(fixtureSourcePath, 'completions', 'snippets.go'), path.join(fixturePath, 'completions', 'snippets.go'));
		fs.copySync(path.join(fixtureSourcePath, 'completions', 'exportedMemberDocs.go'), path.join(fixturePath, 'completions', 'exportedMemberDocs.go'));
		fs.copySync(path.join(fixtureSourcePath, 'importTest', 'noimports.go'), path.join(fixturePath, 'importTest', 'noimports.go'));
		fs.copySync(path.join(fixtureSourcePath, 'importTest', 'groupImports.go'), path.join(fixturePath, 'importTest', 'groupImports.go'));
		fs.copySync(path.join(fixtureSourcePath, 'importTest', 'singleImports.go'), path.join(fixturePath, 'importTest', 'singleImports.go'));
		fs.copySync(path.join(fixtureSourcePath, 'fillStruct', 'input_1.go'), path.join(fixturePath, 'fillStruct', 'input_1.go'));
		fs.copySync(path.join(fixtureSourcePath, 'fillStruct', 'golden_1.go'), path.join(fixturePath, 'fillStruct', 'golden_1.go'));
		fs.copySync(path.join(fixtureSourcePath, 'fillStruct', 'input_2.go'), path.join(fixturePath, 'fillStruct', 'input_2.go'));
		fs.copySync(path.join(fixtureSourcePath, 'fillStruct', 'golden_2.go'), path.join(fixturePath, 'fillStruct', 'golden_2.go'));
		fs.copySync(path.join(fixtureSourcePath, 'fillStruct', 'input_2.go'), path.join(fixturePath, 'fillStruct', 'input_3.go'));
	});

	suiteTeardown(() => {
		fs.removeSync(repoPath);
		fs.removeSync(testPath);
	});

	test('Test Outline', (done) => {
		let filePath = path.join(fixturePath, 'test.go');
		let options = { fileName: filePath };
		documentSymbols(options, null).then(outlines => {
			let packageOutline = outlines[0];
			let symbols = packageOutline.children;
			let imports = symbols.filter(x => x.type === 'import');
			let functions = symbols.filter(x => x.type === 'function');

			assert.equal(packageOutline.type, 'package');
			assert.equal(packageOutline.label, 'main');
			assert.equal(imports[0].label, '"fmt"');
			assert.equal(functions[0].label, 'print');
			assert.equal(functions[1].label, 'main');
			done();
		}, done);
	});

	test('Test Outline imports only', (done) => {
		let filePath = path.join(fixturePath, 'test.go');
		let options = { fileName: filePath, importsOnly: true };
		documentSymbols(options, null).then(outlines => {
			let packageOutline = outlines[0];
			let symbols = packageOutline.children;
			let imports = symbols.filter(x => x.type === 'import');
			let functions = symbols.filter(x => x.type === 'function');

			assert.equal(packageOutline.type, 'package');
			assert.equal(packageOutline.label, 'main');
			assert.equal(imports[0].label, '"fmt"');
			assert.equal(functions.length, 0);
			assert.equal(imports.length, 1);
			done();
		}, done);
	});

	test('getImportPath()', () => {
		let testCases: [string, string][] = [
			['import "github.com/sirupsen/logrus"', 'github.com/sirupsen/logrus'],
			['import "net/http"', 'net/http'],
			['"github.com/sirupsen/logrus"', 'github.com/sirupsen/logrus'],
			['', ''],
			['func foo(bar int) (int, error) {', ''],
			['// This is a comment, complete with punctuation.', '']
		];

		testCases.forEach(run => {
			assert.equal(run[1], getImportPath(run[0]));
		});
	});
});
