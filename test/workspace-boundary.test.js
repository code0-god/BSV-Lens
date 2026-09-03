'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    isPathInsideWorkspace,
    validateTrustedExternalPath
} = require('../src/security/workspace-boundary');
const { WorkspaceAnalyzer } = require('../src/architecture/analyzer');
const { BscScheduleProvider } = require('../src/compiler/bsc-schedule-provider');

test('trusted workspace permits inside and explicit external reports', async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bsv-lens-boundary-'));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const workspace = path.join(root, 'workspace');
    const external = path.join(root, 'external');
    await fs.mkdir(path.join(workspace, 'build'), { recursive: true });
    await fs.mkdir(external);
    await fs.writeFile(path.join(workspace, 'build', 'inside.sched'), '');
    await fs.writeFile(path.join(external, 'outside.sched'), '');

    const inside = await validateTrustedExternalPath({
        workspacePath: workspace,
        basePath: workspace,
        value: 'build/inside.sched',
        workspaceTrusted: true,
        purpose: 'schedule report'
    });
    const outside = await validateTrustedExternalPath({
        workspacePath: workspace,
        basePath: workspace,
        value: path.join(external, 'outside.sched'),
        workspaceTrusted: true,
        purpose: 'schedule report'
    });

    assert.equal(inside.allowed, true);
    assert.equal(inside.insideWorkspace, true);
    assert.equal(outside.allowed, true);
    assert.equal(outside.insideWorkspace, false);
});

test('restricted workspace permits inside source and blocks external paths', async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bsv-lens-restricted-'));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const workspace = path.join(root, 'workspace');
    const external = path.join(root, 'external');
    await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
    await fs.mkdir(external);
    await fs.writeFile(path.join(workspace, 'src', 'Top.bsv'), '');
    await fs.writeFile(path.join(external, 'outside.sched'), '');

    const source = await validateTrustedExternalPath({
        workspacePath: workspace,
        basePath: workspace,
        value: 'src/Top.bsv',
        workspaceTrusted: false,
        purpose: 'source file'
    });
    const parentEscape = await validateTrustedExternalPath({
        workspacePath: workspace,
        basePath: workspace,
        value: '../external/outside.sched',
        workspaceTrusted: false,
        purpose: 'schedule report'
    });
    const absoluteExternal = await validateTrustedExternalPath({
        workspacePath: workspace,
        basePath: workspace,
        value: path.join(external, 'outside.sched'),
        workspaceTrusted: false,
        purpose: 'schedule report'
    });

    assert.equal(source.allowed, true);
    assert.equal(source.insideWorkspace, true);
    for (const result of [parentEscape, absoluteExternal]) {
        assert.equal(result.allowed, false);
        assert.equal(result.reason, 'External schedule reports require a trusted workspace.');
    }
});

test('restricted workspace rejects symlink escape', async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bsv-lens-symlink-'));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const workspace = path.join(root, 'workspace');
    const external = path.join(root, 'external');
    await fs.mkdir(workspace);
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, 'outside.sched'), '');
    await fs.symlink(external, path.join(workspace, 'linked'));

    const result = await validateTrustedExternalPath({
        workspacePath: workspace,
        basePath: workspace,
        value: 'linked/outside.sched',
        workspaceTrusted: false,
        purpose: 'schedule report'
    });

    assert.equal(result.allowed, false);
    assert.equal(result.insideWorkspace, false);
});

test('path containment handles Windows drive case and UNC roots', () => {
    assert.equal(
        isPathInsideWorkspace('C:\\Work\\BSV', 'c:\\work\\bsv\\src\\Top.bsv', path.win32),
        true
    );
    assert.equal(
        isPathInsideWorkspace('C:\\Work\\BSV', 'D:\\Work\\BSV\\Top.bsv', path.win32),
        false
    );
    assert.equal(
        isPathInsideWorkspace('\\\\server\\share\\bsv', '\\\\SERVER\\SHARE\\BSV\\Top.bsv', path.win32),
        true
    );
});

test('untrusted workspace never executes BSC', async () => {
    let executions = 0;
    const provider = new BscScheduleProvider({
        realpath: async (value) => value,
        readFile: async () => { throw new Error('missing'); },
        execFile() { executions += 1; }
    });

    const result = await provider.analyze({
        workspacePath: '/workspace',
        workspaceTrusted: false,
        inputFiles: ['/workspace/Top.bsv'],
        scheduling: {
            topModule: 'mkTop',
            workingDirectory: '.',
            reportFiles: []
        }
    });

    assert.equal(result.available, false);
    assert.equal(result.reason, 'BSC execution is disabled in an untrusted workspace.');
    assert.equal(executions, 0);
});

test('untrusted workspace rejects external working directory before reads', async () => {
    let reads = 0;
    let executions = 0;
    const provider = new BscScheduleProvider({
        realpath: async (value) => value,
        readFile: async () => { reads += 1; return ''; },
        execFile() { executions += 1; }
    });

    const result = await provider.analyze({
        workspacePath: '/workspace',
        workspaceTrusted: false,
        scheduling: {
            workingDirectory: '../external',
            reportFiles: ['Top.sched']
        }
    });

    assert.equal(result.available, false);
    assert.equal(result.reason, 'External BSC working directories require a trusted workspace.');
    assert.equal(reads, 0);
    assert.equal(executions, 0);
});

test('restricted analyzer keeps inside source and skips outside source', async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bsv-lens-source-'));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const workspacePath = path.join(root, 'workspace');
    const externalPath = path.join(root, 'external');
    await fs.mkdir(workspacePath);
    await fs.mkdir(externalPath);
    const insidePath = path.join(workspacePath, 'Top.bsv');
    const outsidePath = path.join(externalPath, 'Outside.bsv');
    await fs.writeFile(insidePath, 'package Top; module mkTop(Empty); endmodule endpackage');
    await fs.writeFile(outsidePath, 'package Outside; module mkOutside(Empty); endmodule endpackage');
    const fileUri = (filePath) => ({
        scheme: 'file',
        fsPath: filePath,
        path: filePath,
        toString: () => `file://${filePath}`
    });
    const folder = { name: 'workspace', uri: fileUri(workspacePath) };
    const vscode = {
        FileType: { Directory: 2 },
        RelativePattern: class RelativePattern {
            constructor(base, pattern) {
                this.base = base;
                this.pattern = pattern;
            }
        },
        Uri: {
            joinPath(base, ...parts) {
                return fileUri(path.join(base.fsPath, ...parts));
            }
        },
        workspace: {
            isTrusted: false,
            getConfiguration() {
                return {
                    get(_key, fallback) { return fallback; },
                    inspect() { return null; }
                };
            },
            async findFiles() {
                return [fileUri(insidePath), fileUri(outsidePath)];
            },
            fs: {
                async readFile(uri) {
                    if (uri.fsPath.endsWith('.bsv-arch.json')) {
                        const error = new Error('not found');
                        error.code = 'FileNotFound';
                        throw error;
                    }
                    return fs.readFile(uri.fsPath);
                },
                async stat() {
                    const error = new Error('not found');
                    error.code = 'FileNotFound';
                    throw error;
                }
            }
        }
    };

    const model = await new WorkspaceAnalyzer(vscode).analyze({ folder });

    assert.equal(model.stats.files, 1);
    assert.equal(model.files[0].packageName, 'Top');
    assert.equal(model.security.restrictedMode, true);
    assert.ok(model.diagnostics.some((item) => /External source files/.test(item.message)));
});

test('manifest declares limited untrusted workspace support', () => {
    const manifest = require('../package.json');
    assert.equal(manifest.capabilities.untrustedWorkspaces.supported, 'limited');
    assert.match(manifest.capabilities.untrustedWorkspaces.description, /source analysis/i);
});
