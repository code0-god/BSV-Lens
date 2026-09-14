#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const { chromium } = require('@playwright/test');
const { resolveCliPathFromVSCodeExecutablePath } = require('@vscode/test-electron');
const { observationScript, readArchiveIdentity, validateInstalledTarget } = require('../../../scripts/run-vsix-smoke');
const { createChannel, reservePort, deadline, findWebview } = require('./native-channel.cjs');
const { runtimeInventory, inventoryFromEntries, installerDelta, assertRuntimeMatch, harnessInventory } = require('./native-runtime.cjs');
const { prepareObserverVsix, readObserverVsix } = require('./observer-vsix.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const VSCODE = path.join(ROOT, '.vscode-test/vscode-darwin-arm64-1.136.1/Visual Studio Code.app/Contents/MacOS/Code');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256 = file => digest(fs.readFileSync(file));
function localeArguments(locale) {
    if (locale === undefined) return [];
    assert.ok(locale === 'en' || locale === 'ko', 'Native test locale must be en or ko');
    return [`--locale=${locale}`];
}
function validateLanguagePackManifest(manifest) {
    assert.equal(`${manifest.publisher}.${manifest.name}`.toLowerCase(), 'ms-ceintl.vscode-language-pack-ko');
    assert.equal(manifest.main, undefined); assert.equal(manifest.browser, undefined);
    assert.deepEqual(Object.keys(manifest.contributes), ['localizations']);
    assert.equal(manifest.contributes.localizations.length, 1);
    const localization = manifest.contributes.localizations[0]; assert.equal(localization.languageId, 'ko');
    const translation = localization.translations.find(item => item.id === 'vscode'); assert.ok(translation);
    const relative = translation.path.replace(/^\.\//, '');
    assert.match(relative, /^translations\/[A-Za-z0-9_./-]+\.json$/);
    assert.ok(!relative.split('/').includes('..')); assert.match(manifest.version, /^\d+\.\d+\.[\d.]+$/);
    return relative;
}
function readLanguagePack(file, locale) {
    if (!file) return null;
    assert.equal(locale, 'ko', 'The isolated Korean language pack requires locale ko');
    file = fs.realpathSync(file); assert.ok(fs.statSync(file).isFile() && fs.statSync(file).size <= 8 * 1024 * 1024);
    execFileSync('/usr/bin/unzip', ['-tqq', file]);
    const manifest = JSON.parse(execFileSync('/usr/bin/unzip', ['-p', file, 'extension/package.json'], { maxBuffer: 1048576 }));
    const translationPath = validateLanguagePackManifest(manifest);
    const translation = execFileSync('/usr/bin/unzip', ['-p', file, `extension/${translationPath}`], { maxBuffer: 16 * 1024 * 1024 });
    return { path: file, bytes: fs.statSync(file).size, sha256: sha256(file), id: 'ms-ceintl.vscode-language-pack-ko',
        version: manifest.version, translationPath, translationSha256: digest(translation), crc: 'PASS' };
}
function assertIsolatedArguments(argv, isolation) {
    for (const [option, name] of [['user-data-dir', 'userDataDir'], ['extensions-dir', 'extensionsDir'], ['shared-data-dir', 'sharedDataDir']]) {
        const directory = isolation[name];
        assert.equal(path.dirname(directory), isolation.profile, `${option} escaped the private profile`);
        assert.deepEqual(argv.filter(value => value.startsWith(`--${option}=`)), [`--${option}=${directory}`], `${option} must identify the single isolated directory`);
    }
    assert.equal(new Set([isolation.userDataDir, isolation.extensionsDir, isolation.sharedDataDir]).size, 3, 'Isolation stores must be distinct');
}

function reuseProfile({ receiptPath, vsix, observerVsix, workspace, workspaceConfiguration, vscodeExecutable, locale }) {
    const file = path.resolve(receiptPath), runs = fs.realpathSync(path.join(ROOT, '.build/hardware/runs'));
    assert.ok(!fs.lstatSync(file).isSymbolicLink() && fs.lstatSync(file).isFile() && fs.statSync(file).size <= 8 * 1024 * 1024);
    const relative = path.relative(runs, fs.realpathSync(file));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(file) === 'native-receipt.json', 'Prior receipt must belong to an owned native run');
    const bytes = fs.readFileSync(file), previous = JSON.parse(bytes);
    assert.equal(previous.schema, 'bsv-g6-native-driver-v1'); assert.equal(previous.targetMode, 'installed'); assert.equal(previous.status, 'passed');
    assert.equal(previous.installedRuntimeIdentity, 'PASS'); assert.equal(previous.installedRuntimeUnchanged, true); assert.equal(previous.harnessUnchanged, true);
    assert.equal(previous.shutdown?.code, 0); assert.equal(previous.shutdown?.signal, null); assert.ok(previous.finishedAt);
    assert.equal(previous.workspace, workspace, 'Restart workspace differs');
    assert.deepEqual(previous.workspaceConfiguration, workspaceConfiguration, 'Restart workspace configuration differs');
    assert.equal(previous.vsixSha256, sha256(vsix), 'Restart product VSIX differs');
    assert.ok(observerVsix); assert.equal(previous.observerPackage?.sha256, sha256(observerVsix), 'Restart observer VSIX differs');
    assert.equal(previous.vscodeExecutable, vscodeExecutable, 'Restart VS Code executable differs');
    assert.equal(previous.localeRequested ?? null, locale ?? null, 'Restart locale differs');
    assert.ok(Number.isSafeInteger(previous.launch?.pid) && previous.launch.pid > 0, 'Prior process identity missing');
    let running = true; try { process.kill(previous.launch.pid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; running = false; }
    assert.equal(running, false, 'Prior VS Code process is still running');
    const isolation = previous.isolation, profile = isolation.profile, stat = fs.lstatSync(profile);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(path.dirname(fs.realpathSync(profile)), fs.realpathSync(os.tmpdir()), 'Profile is not in the private temporary root');
    assert.match(path.basename(profile), /^bg6-[A-Za-z0-9]+$/); assert.equal(stat.mode & 0o077, 0, 'Profile is not private');
    if (process.getuid) assert.equal(stat.uid, process.getuid(), 'Profile belongs to another user');
    for (const [key, basename] of [['userDataDir', 'user-data'], ['extensionsDir', 'extensions'], ['sharedDataDir', 'shared-data']]) {
        assert.equal(isolation[key], path.join(profile, basename));
        const info = fs.lstatSync(isolation[key]); assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Private store must be a real directory');
    }
    const installed = previous.installedTarget?.extensionPath;
    assert.ok(typeof installed === 'string' && !fs.lstatSync(installed).isSymbolicLink(), 'Installed extension leaf must not be a symlink');
    const installedRelative = path.relative(fs.realpathSync(isolation.extensionsDir), fs.realpathSync(installed));
    assert.ok(installedRelative && !installedRelative.includes(path.sep) && installedRelative.startsWith('code0-god.bsv-lens-'));
    assert.equal(runtimeInventory(installed).rawFingerprint, previous.installedRuntimeAfter?.rawFingerprint, 'Installed runtime changed after prior validation');
    const storage = path.join(isolation.userDataDir, 'User/workspaceStorage'), inventory = []; let total = 0, entries = 0;
    function visit(entry, depth = 0) {
        assert.ok(depth <= 16 && ++entries <= 4096, 'Workspace state inventory limit');
        const info = fs.lstatSync(entry); assert.ok(!info.isSymbolicLink(), 'Workspace state symlinks are forbidden');
        if (info.isDirectory()) for (const name of fs.readdirSync(entry).sort()) visit(path.join(entry, name), depth + 1);
        else { assert.ok(info.isFile() && info.size <= 16 * 1024 * 1024); total += info.size; assert.ok(total <= 64 * 1024 * 1024);
            inventory.push({ path: path.relative(storage, entry), bytes: info.size, sha256: sha256(entry) }); }
    }
    const user = fs.lstatSync(path.join(isolation.userDataDir, 'User')); assert.ok(user.isDirectory() && !user.isSymbolicLink());
    visit(storage);
    return { ...isolation, previousReceipt: { path: file, bytes: bytes.length, sha256: digest(bytes) }, previousPid: previous.launch.pid,
        workspaceStateBefore: { directory: storage, files: inventory, bytes: total, fingerprint: digest(JSON.stringify(inventory)) } };
}

function archiveRuntime(vsix) {
    execFileSync('/usr/bin/unzip', ['-tqq', vsix], { stdio: ['ignore', 'pipe', 'pipe'] });
    const entries = execFileSync('/usr/bin/unzip', ['-Z1', vsix], { encoding: 'utf8' }).trim().split('\n');
    const files = entries.filter(name => !name.endsWith('/') && /^extension\/(?:package\.json$|src\/|media\/|node_modules\/)/.test(name)).map(name => {
        const bytes = execFileSync('/usr/bin/unzip', ['-p', vsix, name], { maxBuffer: 64 * 1024 * 1024 });
        return { path: name.slice('extension/'.length), bytes };
    });
    assert.ok(files.length, 'VSIX runtime inventory is empty');
    return { ...inventoryFromEntries(files, 'VSIX package.json/src/media/node_modules'), crc: 'PASS', entries: entries.length };
}

async function launchNative(options) {
    assert.ok(options.vsix && !options.developmentRoot, 'launchNative requires VSIX and forbids developmentRoot');
    if (options.restricted) assert.ok(options.observerVsix, 'Restricted native validation requires an installed observer VSIX');
    return launch(options, 'installed');
}
async function launchDevelopment(options) {
    assert.ok(options.developmentRoot && !options.vsix, 'launchDevelopment requires explicit developmentRoot and forbids VSIX');
    return launch(options, 'development');
}
async function launch(options, targetMode) {
    const localeArgs = localeArguments(options.locale);
    const languagePack = readLanguagePack(options.languagePackVsix, options.locale);
    const vsix = targetMode === 'installed' ? fs.realpathSync(options.vsix) : null;
    const developmentRoot = targetMode === 'development' ? fs.realpathSync(options.developmentRoot) : null;
    const observerVsix = options.observerVsix ? fs.realpathSync(options.observerVsix) : null;
    const workspace = fs.realpathSync(options.workspace);
    let workspaceFile = null, workspaceConfiguration = null;
    if (options.workspaceFile) {
        workspaceFile = fs.realpathSync(options.workspaceFile);
        const bytes = fs.readFileSync(workspaceFile);
        assert.ok(bytes.length <= 65536 && workspaceFile.endsWith('.code-workspace'), 'Bounded test workspace file required');
        const value = JSON.parse(bytes);
        assert.deepEqual(Object.keys(value), ['folders'], 'Test workspace permits folders only, never settings/tasks/scripts');
        assert.ok(Array.isArray(value.folders) && value.folders.length > 0 && value.folders.length <= 8);
        const folders = value.folders.map(folder => {
            assert.ok(folder && Object.keys(folder).every(key => ['path', 'name'].includes(key)) && typeof folder.path === 'string');
            const root = fs.realpathSync(path.resolve(path.dirname(workspaceFile), folder.path));
            assert.ok(fs.statSync(root).isDirectory()); return root;
        });
        assert.ok(folders.includes(workspace), 'Primary observer workspace must be in the explicit workspace file');
        workspaceConfiguration = { file: workspaceFile, sha256: digest(bytes), folders };
    }
    const vscodeExecutable = fs.realpathSync(options.vscodeExecutable || VSCODE), output = path.resolve(options.output);
    assert.equal(path.basename(output), 'g6', 'Output must be a unique run directory ending in /g6');
    assert.ok(fs.statSync(workspace).isDirectory(), 'Workspace must be an existing folder');
    fs.accessSync(vscodeExecutable, fs.constants.X_OK); fs.mkdirSync(output, { recursive: true });
    const receiptPath = path.join(output, 'native-receipt.json');
    fs.writeFileSync(receiptPath, '{}\n', { flag: 'wx' });
    assert.ok(!options.reuseProfileReceipt || targetMode === 'installed', 'Profile reuse requires installed mode');
    const reused = options.reuseProfileReceipt ? reuseProfile({ receiptPath: options.reuseProfileReceipt, vsix, observerVsix,
        workspace, workspaceConfiguration, vscodeExecutable, locale: options.locale }) : null;
    const profile = reused?.profile || fs.mkdtempSync(path.join(os.tmpdir(), 'bg6-'));
    const userDataDir = path.join(profile, 'user-data'), extensionsDir = path.join(profile, 'extensions'), sharedDataDir = path.join(profile, 'shared-data');
    if (!reused) { fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true }); fs.mkdirSync(extensionsDir); fs.mkdirSync(sharedDataDir); }
    const mainFile = path.resolve(path.dirname(vscodeExecutable), '../Resources/app/out/main.js');
    assert.ok(fs.readFileSync(mainFile, 'utf8').includes('"shared-data-dir"'), 'Selected VS Code must support explicit shared-data-dir isolation');
    const settings = { 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false,
        'extensions.autoCheckUpdates': false, 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none',
        'security.workspace.trust.enabled': true, 'security.workspace.trust.emptyWindow': false,
        'security.workspace.trust.startupPrompt': options.restricted ? 'always' : 'never',
        'security.workspace.trust.banner': options.restricted ? 'always' : 'never', 'window.dialogStyle': 'custom', 'git.openRepositoryInParentFolders': 'never', 'git.autofetch': false };
    fs.writeFileSync(path.join(userDataDir, 'User/settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
    const receipt = { schema: 'bsv-g6-native-driver-v1', scope: targetMode === 'installed' ? 'installed-command-smoke' : 'development-native',
        targetMode, developmentRoot, status: 'running', startedAt: new Date().toISOString(), localeRequested: options.locale ?? null, languagePack,
        vsix, vsixSha256: vsix ? sha256(vsix) : null, workspace, workspaceConfiguration, vscodeExecutable, isolation: { profile, userDataDir, extensionsDir, sharedDataDir,
            placementReason: 'Short private temporary profile avoids the macOS 103-byte Unix-domain IPC pathname limit; evidence remains in the unique G6 run.' },
        sharedDataOptionEvidence: { option: '--shared-data-dir', mainFile, mainSha256: sha256(mainFile),
            reason: 'VS Code 1.136 application-shared trust storage is separate from user-data-dir; all launch and CLI calls must isolate it.' },
        restart: reused, restrictedRequested: Boolean(options.restricted), settings, commands: [], errors: [], journeys: [], installerDelta: null,
        observerPackage: observerVsix ? readObserverVsix(observerVsix) : null,
        harness: harnessInventory(options.harnessFiles),
        tracePolicy: { screenshots: false, snapshots: true, sources: false, explicitPngCaptures: true,
            reason: 'Preserve actual actions and DOM snapshots; capture original PNGs at explicit acceptance checkpoints instead of duplicating a continuous JPEG filmstrip.' },
        launchPolicy: `Ordinary Code launch; product ${targetMode === 'installed' ? 'installed from the explicit VSIX' : 'loaded from the explicit development root'}; observer ${observerVsix ? 'installed from the explicit observer VSIX' : 'loaded as an explicit development extension'}. No extensionTestsPath: VS Code suppresses/refuses real dialogs in extension tests.` };
    const save = () => fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    let channel, child, exited, browser, context, targetVersion, closing = false, checkpointing = false, traceSequence = 0;
    const recordTrace = (file, label) => {
        (receipt.traceChunks ||= []).push({ path: path.basename(file), label, bytes: fs.statSync(file).size, sha256: sha256(file) }); save();
    };
    const close = async (status = 'passed', error = null) => {
        if (closing) return; closing = true;
        receipt.status = status; if (error) receipt.failure = error?.stack || String(error);
        try {
            if (browser) {
                receipt.frames = context.pages().flatMap((page, index) => page.frames().map(frame => ({ page: index, url: frame.url(), name: frame.name() })));
                const cdp = await browser.newBrowserCDPSession(); receipt.targets = (await cdp.send('Target.getTargets')).targetInfos; await cdp.detach();
                const file = path.join(output, 'native-trace.zip');
                await context.tracing.stop({ path: file }); recordTrace(file, 'final');
            }
        } catch (captureError) { receipt.errors.push({ surface: 'closing-capture', message: captureError.message }); }
        try {
            if (child && child.exitCode === null && child.signalCode === null) {
                await channel?.request('finish', {}, 5000).catch(finishError => { receipt.finishError = finishError.message; });
                receipt.shutdown = await deadline(exited, 20000, 'Graceful isolated VS Code exit');
            } else if (exited) receipt.shutdown = await exited;
        } catch (shutdownError) {
            receipt.shutdownError = shutdownError.message; receipt.status = 'failed';
            if (child?.pid && child.exitCode === null && child.signalCode === null) {
                try { process.kill(-child.pid, 'SIGTERM'); } catch (killError) { if (killError.code !== 'ESRCH') throw killError; }
                try { receipt.shutdown = await deadline(exited, 5000, 'Isolated process-group termination'); }
                catch { try { process.kill(-child.pid, 'SIGKILL'); } catch (killError) { if (killError.code !== 'ESRCH') throw killError; } receipt.shutdown = await exited; }
            }
        } finally {
            await browser?.close().catch(closeError => { receipt.browserClose = closeError.message; });
            await channel?.close(); receipt.finishedAt = new Date().toISOString();
            if (vsix) {
                assert.equal(sha256(vsix), receipt.vsixSha256, 'VSIX changed during installed validation');
                if (receipt.installedTarget) {
                    receipt.installedRuntimeAfter = runtimeInventory(receipt.installedTarget.extensionPath);
                    receipt.installedRuntimeUnchanged = receipt.installedRuntimeAfter.rawFingerprint === receipt.installedTarget.runtime.rawFingerprint;
                    if (!receipt.installedRuntimeUnchanged) receipt.status = 'failed';
                }
            }
            if (observerVsix) assert.equal(sha256(observerVsix), receipt.observerPackage.sha256, 'Test observer VSIX changed during validation');
            else if (receipt.developmentRuntime) {
                receipt.developmentRuntimeAfter = runtimeInventory(developmentRoot, false);
                receipt.developmentRuntimeUnchanged = receipt.developmentRuntime.rawFingerprint === receipt.developmentRuntimeAfter.rawFingerprint;
                if (!receipt.developmentRuntimeUnchanged) receipt.status = 'failed';
            }
            if (languagePack) {
                assert.equal(sha256(languagePack.path), languagePack.sha256, 'Korean language pack changed during validation');
                if (receipt.installedLanguagePack) assert.equal(sha256(path.join(receipt.installedLanguagePack.path, languagePack.translationPath)),
                    languagePack.translationSha256, 'Installed Korean translation changed');
            }
            if (workspaceFile) assert.equal(sha256(workspaceFile), workspaceConfiguration.sha256, 'Explicit workspace configuration changed during validation');
            receipt.harnessAfter = harnessInventory(options.harnessFiles);
            receipt.harnessUnchanged = receipt.harness.rawFingerprint === receipt.harnessAfter.rawFingerprint;
            if (!receipt.harnessUnchanged) receipt.status = 'failed';
            receipt.observerFailures = channel?.records.filter(record => record.type === 'observerFatal') || [];
            if (receipt.observerFailures.length) receipt.status = 'failed';
            save();
        }
        if (receipt.shutdown && receipt.shutdown.code !== 0) { receipt.status = 'failed'; save(); }
        return receipt;
    };
    try {
        if (vsix) {
            receipt.archive = readArchiveIdentity(vsix); targetVersion = receipt.archive.version;
            receipt.archiveRuntime = archiveRuntime(vsix); save();
            const cli = resolveCliPathFromVSCodeExecutablePath(vscodeExecutable); fs.accessSync(cli, fs.constants.X_OK);
            for (const args of [...(localeArgs.length ? [['--help']] : []), ['--version'], ['--install-extension', vsix, '--force'],
                ...(observerVsix ? [['--install-extension', observerVsix, '--force']] : []),
                ...(languagePack ? [['--install-extension', languagePack.path, '--force']] : []), ['--list-extensions', '--show-versions']]) {
                const argv = [`--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`, `--shared-data-dir=${sharedDataDir}`, ...args];
                assertIsolatedArguments(argv, receipt.isolation);
                const result = await promisify(execFile)(cli, argv, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
                if (args[0] === '--help') assert.match(result.stdout, /--locale/, 'Selected Code CLI does not advertise locale support');
                receipt.commands.push({ phase: args[0], executable: cli, argv, exitCode: 0, stdout: result.stdout, stderr: result.stderr }); save();
            }
            assert.ok(receipt.commands.at(-1).stdout.split(/\r?\n/).includes(`code0-god.bsv-lens@${targetVersion}`));
            if (languagePack) {
                const installed = fs.readdirSync(extensionsDir).filter(name => name.toLowerCase().startsWith(`${languagePack.id}-`));
                assert.equal(installed.length, 1, 'Exactly one isolated Korean language pack must be installed');
                const directory = fs.realpathSync(path.join(extensionsDir, installed[0]));
                assert.equal(path.dirname(directory), fs.realpathSync(extensionsDir));
                const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
                assert.equal(manifest.version, languagePack.version); assert.equal(validateLanguagePackManifest(manifest), languagePack.translationPath);
                assert.equal(sha256(path.join(directory, languagePack.translationPath)), languagePack.translationSha256);
                receipt.installedLanguagePack = { path: directory, id: languagePack.id, version: languagePack.version,
                    translationSha256: languagePack.translationSha256 }; save();
            }
        } else {
            const manifest = JSON.parse(fs.readFileSync(path.join(developmentRoot, 'package.json')));
            assert.equal(`${manifest.publisher}.${manifest.name}`, 'code0-god.bsv-lens'); targetVersion = manifest.version;
            receipt.developmentRuntime = runtimeInventory(developmentRoot, false); save();
        }
        channel = await createChannel(path.join(output, 'native-events.jsonl'));
        const port = await reservePort(), observer = path.join(__dirname, 'observer');
        const args = [workspaceFile || workspace, '--new-window', `--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`,
            `--shared-data-dir=${sharedDataDir}`, ...localeArgs,
            ...(observerVsix ? [] : [`--extensionDevelopmentPath=${observer}`]),
            `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--skip-welcome', '--skip-release-notes',
            '--disable-updates', '--no-cached-data'];
        if (!options.restricted) args.push('--disable-workspace-trust');
        if (developmentRoot) args.push(`--extensionDevelopmentPath=${developmentRoot}`);
        assertIsolatedArguments(args, receipt.isolation);
        const env = { ...process.env, G6_OBSERVER_PORT: String(channel.port), G6_OBSERVER_TOKEN: channel.token,
            G6_EXTENSIONS_DIR: extensionsDir, G6_WORKSPACE_ROOT: workspace, G6_TARGET_MODE: targetMode,
            G6_TARGET_VERSION: targetVersion,
            G6_OBSERVER_AUTORUN: '1',
            ...(developmentRoot ? { G6_TARGET_ROOT: developmentRoot } : {}) };
        if (!developmentRoot) delete env.G6_TARGET_ROOT;
        delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
        receipt.launch = { executable: vscodeExecutable, argv: args, observerExtensionPath: observerVsix ? null : observer,
            targetDevelopmentPath: developmentRoot, extensionTestsPath: null, cdp: { host: '127.0.0.1', port }, environmentKeys: ['G6_OBSERVER_PORT', 'G6_OBSERVER_TOKEN', 'G6_EXTENSIONS_DIR', 'G6_WORKSPACE_ROOT', 'G6_TARGET_MODE', 'G6_TARGET_VERSION', 'G6_OBSERVER_AUTORUN', ...(developmentRoot ? ['G6_TARGET_ROOT'] : [])] };
        const stdout = fs.createWriteStream(path.join(output, 'native.stdout.log'), { flags: 'wx' });
        const stderr = fs.createWriteStream(path.join(output, 'native.stderr.log'), { flags: 'wx' });
        child = spawn(vscodeExecutable, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.pipe(stdout); child.stderr.pipe(stderr); receipt.launch.pid = child.pid;
        exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
        exited.catch(() => {}); save();
        const ready = await deadline(Promise.race([channel.waitFor('observerReady', () => true, 60000),
            exited.then(value => { throw new Error(`VS Code exited before observerReady: ${JSON.stringify(value)}`); })]), 60000, 'Native observer readiness');
        receipt.environment = ready.environment;
        receipt.observer = ready.observer;
        if (observerVsix) {
            assert.equal(ready.observer.mode, 1, 'Test observer must be installed');
            assert.ok(path.relative(fs.realpathSync(extensionsDir), ready.observer.extensionPath).startsWith('bsv-lens-tests.bsv-lens-g6-observer-'), 'Observer installation escaped isolated extensions directory');
            const archiveManifest = execFileSync('/usr/bin/unzip', ['-p', observerVsix, 'extension/package.json']);
            const installedManifest = fs.readFileSync(path.join(ready.observer.extensionPath, 'package.json'));
            receipt.observerInstallerDelta = installerDelta(archiveManifest, installedManifest);
            assertRuntimeMatch(receipt.observerPackage.runtime, ready.observer.runtime, receipt.observerInstallerDelta);
        }
        if (vsix) {
            receipt.installedTarget = ready.target; save();
            validateInstalledTarget(ready.target, fs.realpathSync(extensionsDir));
            const archivedFiles = new Map(receipt.archiveRuntime.rawFiles.map(file => [file.path, file]));
            const installedFiles = new Map(ready.target.runtime.rawFiles.map(file => [file.path, file]));
            receipt.installedDifferences = [...new Set([...archivedFiles.keys(), ...installedFiles.keys()])]
                .filter(file => JSON.stringify(archivedFiles.get(file)) !== JSON.stringify(installedFiles.get(file)))
                .map(file => ({ path: file, archive: archivedFiles.get(file) || null, installed: installedFiles.get(file) || null }));
            const archivedManifest = execFileSync('/usr/bin/unzip', ['-p', vsix, 'extension/package.json']);
            const installedManifest = fs.readFileSync(path.join(ready.target.extensionPath, 'package.json'));
            receipt.installerDelta = installerDelta(archivedManifest, installedManifest);
            fs.writeFileSync(path.join(output, 'archive-package.json'), archivedManifest, { flag: 'wx' });
            fs.writeFileSync(path.join(output, 'installed-package.json'), installedManifest, { flag: 'wx' });
            save();
            assertRuntimeMatch(receipt.archiveRuntime, ready.target.runtime, receipt.installerDelta);
            receipt.installedRuntimeIdentity = 'PASS';
        } else {
            assert.equal(ready.target.extensionPath, developmentRoot); receipt.developmentTarget = ready.target;
            assert.deepEqual(ready.target.runtime.rawFiles, receipt.developmentRuntime.rawFiles, 'Development runtime changed before activation');
            receipt.developmentRuntimeIdentity = 'PASS';
        }
        assert.equal(ready.target.targetMode, targetMode); receipt.environment = ready.environment;
        save();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30000 });
        context = browser.contexts()[0]; assert.ok(context, 'Native Chromium context unavailable');
        await context.addInitScript({ content: observationScript() });
        await context.tracing.start({ screenshots: false, snapshots: true, sources: false });
        const consolePath = path.join(output, 'native-browser-console.jsonl'); fs.writeFileSync(consolePath, '', { flag: 'wx' });
        const observe = page => {
            page.on('pageerror', error => { receipt.errors.push({ surface: 'page', message: error.message }); save(); });
            page.on('console', message => fs.appendFileSync(consolePath, `${JSON.stringify({ at: new Date().toISOString(),
                type: message.type(), text: message.text().slice(0, 16384), location: message.location() })}\n`));
        };
        for (const page of context.pages()) observe(page); context.on('page', observe);
        if (options.restricted) {
            receipt.restrictedWorkbench = await Promise.all(context.pages().map(async page => ({ url: page.url(), text: await page.locator('body').innerText(),
                preloadTrust: await page.evaluate(() => {
                    const config = globalThis.vscode?.context?.configuration();
                    if (!config) return null;
                    return { disableWorkspaceTrust: config['disable-workspace-trust'],
                        trustKeys: Object.keys(config).filter(key => /trust|polic|development|workspace/i.test(key)),
                        cliTrust: config.cli?.['disable-workspace-trust'], policies: config.policies?.WorkspaceTrustEnabled,
                        sharedDataDir: config['shared-data-dir'] };
                }) })));
            receipt.restrictedEditors = await channel.request('observeEditors');
            assert.equal(receipt.restrictedEditors.trusted, false, 'Restricted Mode launch unexpectedly trusted workspace');
        }
        return { browser, context, channel, receipt, output, save, close,
            async traceCheckpoint(label) {
                assert.match(label, /^[A-Za-z0-9_-]{1,64}$/); assert.ok(!closing && !checkpointing, 'Trace checkpoints must be awaited serially');
                checkpointing = true;
                try {
                    const file = path.join(output, `native-trace-${String(++traceSequence).padStart(3, '0')}-${label}.zip`);
                    assert.equal(fs.existsSync(file), false, 'Trace chunk already exists');
                    await context.tracing.stopChunk({ path: file }); recordTrace(file, label);
                    await context.tracing.startChunk({ title: `After ${label}` });
                    return receipt.traceChunks.at(-1);
                } finally { checkpointing = false; }
            },
            findWebview: (selector, timeout) => findWebview(context, selector, timeout),
            async nativeInput({ text, choice, accept = true }, page = context.pages()[0]) {
                const widget = page.locator('.quick-input-widget'); await widget.waitFor({ state: 'visible', timeout: 30000 });
                if (text !== undefined) await widget.locator('input').fill(text);
                if (choice !== undefined) {
                    const row = widget.getByRole('option').filter({ hasText: choice });
                    await row.waitFor({ state: 'visible', timeout: 30000 });
                    assert.equal(await row.count(), 1, 'Native QuickPick choice is ambiguous'); await row.click();
                } else if (accept) await widget.locator('input').press('Enter');
                (receipt.nativeInputs ||= []).push({ at: new Date().toISOString(), text, choice, accept }); save();
            },
            async capture(name, page = context.pages()[0]) {
                assert.match(name, /^[a-zA-Z0-9_-]+$/); const file = path.join(output, `${name}.png`);
                assert.equal(fs.existsSync(file), false, 'Capture already exists'); await page.screenshot({ path: file });
                (receipt.captures ||= []).push({ path: path.basename(file), bytes: fs.statSync(file).size, sha256: sha256(file) }); save(); return file;
            }
        };
    } catch (error) { await close('failed', error); throw error; }
}

function parseArguments(argv) {
    if (argv.includes('--help')) return { help: true };
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const option = argv[index];
        if (option === '--restricted') { options.restricted = true; continue; }
        const key = { '--vsix': 'vsix', '--workspace': 'workspace', '--output': 'output', '--vscode': 'vscodeExecutable', '--workspace-file': 'workspaceFile', '--locale': 'locale' }[option];
        assert.ok(key && argv[index + 1] && !argv[index + 1].startsWith('--'), `Unknown or incomplete argument: ${option}`);
        assert.equal(options[key], undefined, `Duplicate argument: ${option}`); options[key] = argv[++index];
    }
    for (const key of ['vsix', 'workspace', 'output']) assert.ok(options[key], `${key} is required`);
    localeArguments(options.locale);
    return options;
}
async function main() {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) { console.log('node native-driver.cjs --vsix FILE --workspace DIR --output UNIQUE_RUN/g6 [--vscode EXECUTABLE] [--restricted] [--locale en|ko]\nInstalls the explicit VSIX in a fresh isolated profile, opens its experimental command, captures native state, then exits. Full acceptance journeys use launchNative(options).'); return; }
    const native = await launchNative(options);
    try {
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        const { page } = await native.findWebview();
        await native.capture('native-command', page);
        native.receipt.hardware = await native.channel.request('observeHardware');
        await native.close(); assert.equal(native.receipt.status, 'passed');
        console.log(`Native command smoke: ${path.join(native.output, 'native-receipt.json')}`);
    } catch (error) { await native.close('failed', error); throw error; }
}
if (require.main === module) main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
module.exports = { launchNative, launchDevelopment, parseArguments, archiveRuntime, prepareObserverVsix, assertIsolatedArguments, reuseProfile, localeArguments, validateLanguagePackManifest, VSCODE };
