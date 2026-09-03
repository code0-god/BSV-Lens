'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');
const { createLineStarts, offsetToPosition } = require('../architecture/source-utils');
const { validateTrustedExternalPath } = require('../security/workspace-boundary');

const RELATION_KINDS = new Map([
    ['C', 'conflict'],
    ['CONFLICT', 'conflict'],
    ['CF', 'conflict-free'],
    ['CONFLICT-FREE', 'conflict-free'],
    ['CONFLICT_FREE', 'conflict-free'],
    ['SB', 'sequential-before'],
    ['SEQUENTIAL-BEFORE', 'sequential-before'],
    ['SEQUENTIAL_BEFORE', 'sequential-before'],
    ['SBR', 'sequential-before-reverse'],
    ['SEQUENTIAL-BEFORE-REVERSE', 'sequential-before-reverse'],
    ['SEQUENTIAL_BEFORE_REVERSE', 'sequential-before-reverse'],
    ['EO', 'execution-order'],
    ['EXECUTION-ORDER', 'execution-order'],
    ['EXECUTION_ORDER', 'execution-order']
]);

function parseBscScheduleReport(text, options = {}) {
    const report = String(text || '');
    const uri = options.uri || options.path || 'bsc-schedule';
    const lineStarts = createLineStarts(report);
    const relations = [];
    const seen = new Set();
    let executionOrderSection = false;
    let currentMember = null;
    let currentModule = options.moduleName || null;
    let offset = 0;

    for (const rawLine of report.split(/\r?\n/)) {
        const line = rawLine.trim();
        const module = /^(?:Schedule dump for module|=== Generated schedule for)\s+([A-Za-z_$][\w$]*)/i.exec(line);
        if (module) {
            currentModule = cleanRuleName(module[1]);
            offset += rawLine.length + 1;
            continue;
        }
        const member = /^(?:Method|Rule):\s*(.+)$/i.exec(line);
        if (member) {
            currentMember = cleanRuleName(member[1]);
            offset += rawLine.length + 1;
            continue;
        }
        if (/^(?:rule\s+)?execution\s+order\s*:?(?:\s*\(.*\))?$/i.test(line)) {
            executionOrderSection = true;
            offset += rawLine.length + 1;
            continue;
        }
        if (/^[A-Za-z][A-Za-z ]+\s*:$/.test(line) && !/^execution\s+order/i.test(line)) {
            executionOrderSection = false;
        }
        if (!line || /^[-=]+$/.test(line) || /^#/.test(line)) {
            offset += rawLine.length + 1;
            continue;
        }

        const parsed = parseRelationLine(line, executionOrderSection, currentMember);
        for (const item of parsed) {
            if (!item.kind || !item.from || !item.to || item.from === item.to) continue;
            const endpoints = item.kind === 'conflict' || item.kind === 'conflict-free'
                ? [item.from, item.to].sort()
                : [item.from, item.to];
            const key = `${currentModule || ''}\u0000${endpoints[0]}\u0000${endpoints[1]}\u0000${item.kind}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const startColumn = Math.max(0, rawLine.indexOf(line));
            const start = offsetToPosition(lineStarts, offset + startColumn);
            const end = offsetToPosition(lineStarts, offset + rawLine.length);
            relations.push({
                from: item.from,
                to: item.to,
                kind: item.kind,
                origin: 'bsc',
                confidence: 'authoritative',
                bidirectional: item.kind === 'conflict' || item.kind === 'conflict-free',
                evidence: line,
                moduleName: currentModule,
                location: {
                    uri,
                    line: start.line,
                    column: start.column,
                    endLine: end.line,
                    endColumn: end.column
                }
            });
        }
        offset += rawLine.length + 1;
    }
    return relations;
}

function parseRelationLine(line, executionOrderSection, currentMember = null) {
    let match = /^Logical execution order:\s*(.+)$/i.exec(line);
    if (match) return adjacentRelations(parseNameList(match[1]), 'execution-order');

    match = /^Sequenced before:\s*(.+)$/i.exec(line);
    if (match && currentMember) {
        return parseNameList(match[1]).map((target) => makeParsed(currentMember, target, 'sequential-before'));
    }
    match = /^Sequenced after:\s*(.+)$/i.exec(line);
    if (match && currentMember) {
        return parseNameList(match[1]).map((source) => makeParsed(source, currentMember, 'sequential-before'));
    }
    match = /^Conflicts:\s*(.+)$/i.exec(line);
    if (match && currentMember) {
        return parseNameList(match[1]).map((target) => makeParsed(currentMember, target, 'conflict'));
    }
    match = /^Conflict-free:\s*(.+)$/i.exec(line);
    if (match && currentMember) {
        return parseNameList(match[1]).map((target) => makeParsed(currentMember, target, 'conflict-free'));
    }

    const compact = /^\s*(?:rule\s+)?("[^"]+"|'[^']+'|[^\s:]+)\s*(?::|\s)\s*(C|CF|SB|SBR|EO|CONFLICT(?:[-_]FREE)?|SEQUENTIAL[-_]BEFORE(?:[-_]REVERSE)?|EXECUTION[-_]ORDER)\s*(?:->|:)?\s*(?:rule\s+)?("[^"]+"|'[^']+'|[^\s,;]+)\s*[;,]?\s*$/i.exec(line);
    if (compact) return [compactRelation(compact[1], compact[3], compact[2])];

    const grouped = /^\s*(?:rule\s+)?("[^"]+"|'[^']+'|[^\s:]+)\s*:\s*(.+)$/i.exec(line);
    if (grouped) {
        const result = [];
        const pattern = /\b(CF|SBR|SB|C|EO)\b\s*(?:\[([^\]]+)\]|([^;,]+))/gi;
        let match;
        while ((match = pattern.exec(grouped[2])) !== null) {
            const targets = (match[2] || match[3]).split(/\s*,\s*/);
            for (const target of targets) result.push(compactRelation(grouped[1], target, match[1]));
        }
        if (result.length > 0) return result;
    }

    match = /^(?:rule\s+)?("[^"]+"|'[^']+'|\S+)\s+(?:and\s+(?:rule\s+)?("[^"]+"|'[^']+'|\S+)\s+are\s+conflict[- ]free|is\s+conflict[- ]free\s+with\s+(?:rule\s+)?("[^"]+"|'[^']+'|\S+))\.?$/i.exec(line);
    if (match) return [makeParsed(match[1], match[2] || match[3], 'conflict-free')];

    match = /^(?:rule\s+)?("[^"]+"|'[^']+'|\S+)\s+conflicts\s+with\s+(?:rule\s+)?("[^"]+"|'[^']+'|\S+)\.?$/i.exec(line);
    if (match) return [makeParsed(match[1], match[2], 'conflict')];

    match = /^(?:rule\s+)?("[^"]+"|'[^']+'|\S+)\s+(?:must\s+)?(?:execute|executes)\s+before\s+(?:rule\s+)?("[^"]+"|'[^']+'|\S+)\.?$/i.exec(line);
    if (match) return [makeParsed(match[1], match[2], 'execution-order')];

    if (executionOrderSection) {
        match = /^(?:\d+[.)]\s*)?("[^"]+"|'[^']+'|[\w$.:/\[\]-]+)\s*(?:->|<)\s*("[^"]+"|'[^']+'|[\w$.:/\[\]-]+)\s*$/.exec(line);
        if (match) return [makeParsed(match[1], match[2], 'execution-order')];
    }
    return [];
}

function parseNameList(value) {
    const normalized = String(value || '').trim();
    if (!normalized || /^\(none\)$/i.test(normalized)) return [];
    return normalized.split(/\s*,\s*|\s+/).map(cleanRuleName).filter(Boolean);
}

function adjacentRelations(names, kind) {
    return names.slice(0, -1).map((name, index) => makeParsed(name, names[index + 1], kind));
}

function compactRelation(from, to, token) {
    return makeParsed(from, to, RELATION_KINDS.get(String(token).toUpperCase()));
}

function makeParsed(from, to, kind) {
    return { from: cleanRuleName(from), to: cleanRuleName(to), kind };
}

function cleanRuleName(value) {
    return String(value || '').trim().replace(/^["']|["']$/g, '').replace(/[.,;:]$/, '');
}

class BscScheduleProvider {
    constructor(capabilities = {}) {
        this.spawn = capabilities.spawn === undefined ? childProcess.spawn : capabilities.spawn;
        this.execFile = capabilities.execFile || capabilities.exec || null;
        this.readFile = capabilities.readFile || fs.promises.readFile.bind(fs.promises);
        this.realpath = capabilities.realpath || fs.promises.realpath.bind(fs.promises);
        this.makeTempDirectory = capabilities.makeTempDirectory
            || (() => fs.promises.mkdtemp(path.join(os.tmpdir(), 'bsv-architecture-')));
        this.removeDirectory = capabilities.removeDirectory
            || ((directory) => fs.promises.rm(directory, { recursive: true, force: true }));
        this.output = capabilities.output || null;
        this.helpCache = new Map();
    }

    async isAvailable(context = {}, token) {
        const config = schedulingConfig(context);
        const workingDirectoryResult = await this.resolveWorkingDirectory(context, config);
        if (!workingDirectoryResult.allowed) return false;
        const cwd = workingDirectoryResult.path;
        if (await this.hasReadableReport(config.reportFiles, cwd, context, token)) return true;
        if (!isWorkspaceTrusted(context) || isCancelled(token)) return false;
        const probe = await this.probe(config.bscExecutable || 'bsc', cwd, config.timeoutMs, token, context);
        return probe.available;
    }

    async analyze(context = {}, token) {
        const config = schedulingConfig(context);
        const workingDirectoryResult = await this.resolveWorkingDirectory(context, config);
        if (!workingDirectoryResult.allowed) {
            return unavailable(workingDirectoryResult.reason, [blockedDiagnostic(workingDirectoryResult.reason)]);
        }
        const cwd = workingDirectoryResult.path;
        const reportResult = await this.readReports(config.reportFiles, cwd, context, token);
        if (reportResult.cancelled) return unavailable('Scheduling analysis was cancelled.');
        if (reportResult.read > 0) {
            return {
                provider: 'bsc',
                available: true,
                relations: reportResult.relations,
                diagnostics: reportResult.diagnostics,
                source: 'report-files'
            };
        }
        if (!isWorkspaceTrusted(context)) {
            return unavailable(
                'BSC execution is disabled in an untrusted workspace.',
                reportResult.diagnostics
            );
        }
        if (isCancelled(token)) return unavailable('Scheduling analysis was cancelled.');

        const executable = config.bscExecutable || 'bsc';
        const probe = await this.probe(executable, cwd, config.timeoutMs, token, context);
        if (!probe.available) return unavailable(probe.reason || 'BSC scheduling support is unavailable.');

        if (inputFiles(context).length === 0) {
            return unavailable('No BSV input files or top module were supplied for BSC scheduling analysis.');
        }
        let outputDirectory;
        try {
            outputDirectory = await this.makeTempDirectory();
            const argv = buildBscArguments(context, config, outputDirectory);
            const execution = await this.run(executable, argv, {
                cwd,
                timeoutMs: config.timeoutMs,
                token,
                context
            });
            if (execution.cancelled) return unavailable('Scheduling analysis was cancelled.');
            if (execution.timedOut) return unavailable(`BSC scheduling analysis timed out after ${config.timeoutMs} ms.`);
            if (execution.error || execution.code !== 0) {
                return unavailable(`BSC scheduling analysis failed${execution.error ? `: ${execution.error.message}` : ` with exit code ${execution.code}`}.`);
            }

            const text = [execution.stdout, execution.stderr].filter(Boolean).join('\n');
            const generated = await this.readGeneratedReports(text, outputDirectory);
            return {
                provider: 'bsc',
                available: true,
                relations: generated.relations.length > 0
                    ? generated.relations
                    : parseBscScheduleReport(text, { uri: 'bsc://schedule-output' }),
                diagnostics: generated.diagnostics,
                source: generated.relations.length > 0 ? 'compiler-report' : 'compiler-output',
                executable,
                argv,
                stdout: execution.stdout,
                stderr: execution.stderr
            };
        } catch (error) {
            return unavailable(`BSC scheduling analysis failed: ${error.message}`);
        } finally {
            if (outputDirectory) await this.removeDirectory(outputDirectory).catch(() => {});
        }
    }

    async probe(executable, cwd, timeoutMs, token, context) {
        const cacheKey = `${executable}\u0000${cwd}`;
        if (this.helpCache.has(cacheKey)) return this.helpCache.get(cacheKey);
        const result = await this.run(executable, ['-help'], { cwd, timeoutMs, token, context });
        let help = `${result.stdout || ''}\n${result.stderr || ''}`;
        if (!result.error && !result.cancelled && !result.timedOut
            && (!help.includes('-show-schedule') || !help.includes('-show-rule-rel-all'))) {
            const hidden = await this.run(executable, ['-help-hidden'], { cwd, timeoutMs, token, context });
            if (!hidden.error && !hidden.cancelled && !hidden.timedOut) {
                help += `\n${hidden.stdout || ''}\n${hidden.stderr || ''}`;
            }
        }
        const available = !result.error && !result.cancelled && !result.timedOut
            && help.includes('-show-schedule') && help.includes('-show-rule-rel-all');
        const probe = {
            available,
            reason: result.cancelled
                ? 'Scheduling analysis was cancelled.'
                : result.timedOut
                    ? 'The BSC help probe timed out.'
                    : result.error
                        ? `BSC is unavailable: ${result.error.message}`
                        : available
                            ? ''
                            : 'This BSC executable does not advertise -show-schedule and -show-rule-rel-all.'
        };
        if (!result.cancelled) this.helpCache.set(cacheKey, probe);
        return probe;
    }

    async hasReadableReport(reportFiles, cwd, context, token) {
        for (const reportFile of reportFiles || []) {
            if (isCancelled(token)) return false;
            const boundary = await this.resolveReportPath(context, cwd, reportFile);
            if (!boundary.allowed) continue;
            try {
                await callReadFile(this.readFile, boundary.path);
                return true;
            } catch (_) {
                // Missing configured reports are expected before a project has been built.
            }
        }
        return false;
    }

    async readReports(reportFiles, cwd, context, token) {
        const relations = [];
        const diagnostics = [];
        let read = 0;
        for (const reportFile of reportFiles || []) {
            if (isCancelled(token)) return { relations: [], diagnostics, read, cancelled: true };
            const boundary = await this.resolveReportPath(context, cwd, reportFile);
            if (!boundary.allowed) {
                diagnostics.push(blockedDiagnostic(boundary.reason));
                continue;
            }
            try {
                const content = await callReadFile(this.readFile, boundary.path);
                read += 1;
                relations.push(...parseBscScheduleReport(String(content), { uri: boundary.path }));
            } catch (error) {
                diagnostics.push({
                    severity: 'warning',
                    message: `Cannot read BSC schedule report ${reportFile}: ${error.message}`,
                    location: null
                });
            }
        }
        return { relations, diagnostics, read, cancelled: false };
    }

    async readGeneratedReports(output, outputDirectory) {
        const relations = [];
        const diagnostics = [];
        const paths = [...String(output || '').matchAll(/Schedule dump file created:\s*(.+\.sched)\s*$/gim)]
            .map((match) => match[1].trim());
        for (const reportPath of paths) {
            const boundary = await validateTrustedExternalPath({
                workspacePath: outputDirectory,
                basePath: outputDirectory,
                value: reportPath,
                workspaceTrusted: false,
                purpose: 'generated schedule report',
                allowTrustedExternal: false,
                externalReason: 'Generated BSC schedule reports must stay inside the compiler output directory.',
                realpath: this.realpath
            });
            if (!boundary.allowed) {
                diagnostics.push(blockedDiagnostic(boundary.reason));
                continue;
            }
            try {
                const content = await callReadFile(this.readFile, boundary.path);
                relations.push(...parseBscScheduleReport(String(content), { uri: boundary.path }));
            } catch (_) {
                // Some BSC wrappers remove temporary reports before returning.
            }
        }
        return { relations, diagnostics };
    }

    resolveWorkingDirectory(context, config) {
        const root = workspaceRoot(context);
        return validateTrustedExternalPath({
            workspacePath: root,
            basePath: root,
            value: config.workingDirectory || '.',
            workspaceTrusted: isWorkspaceTrusted(context),
            purpose: 'BSC working directory',
            realpath: this.realpath
        });
    }

    resolveReportPath(context, cwd, reportFile) {
        return validateTrustedExternalPath({
            workspacePath: workspaceRoot(context),
            basePath: cwd,
            value: reportFile,
            workspaceTrusted: isWorkspaceTrusted(context),
            purpose: 'schedule report',
            realpath: this.realpath
        });
    }

    run(executable, argv, options) {
        if (this.execFile) return runWithExecFile(this.execFile, executable, argv, options, (text) => this.emit(text, options.context));
        if (!this.spawn) return Promise.resolve({ error: new Error('No process execution capability is available.'), code: null, stdout: '', stderr: '' });
        return runWithSpawn(this.spawn, executable, argv, options, (text) => this.emit(text, options.context));
    }

    emit(text, context) {
        if (!text) return;
        const output = context?.onOutput || context?.output || this.output;
        if (typeof output === 'function') output(text);
        else if (typeof output?.append === 'function') output.append(text);
    }
}

function buildBscArguments(context, config, outputDirectory) {
    const argv = [...(config.arguments || [])];
    if (!argv.some((argument) => ['-sim', '-verilog'].includes(argument))) argv.push('-sim');
    argv.push('-show-schedule', '-show-rule-rel-all');
    if (outputDirectory) {
        argv.push('-bdir', outputDirectory, '-simdir', outputDirectory, '-info-dir', outputDirectory);
    }
    if (config.sourcePaths.length > 0) argv.push('-p', ['+', ...config.sourcePaths].join(path.delimiter));
    if (config.topModule) argv.push('-g', config.topModule);
    argv.push('-u');
    for (const file of inputFiles(context)) argv.push(file);
    return argv;
}

function inputFiles(context) {
    const values = context.inputFiles || context.bsvFiles || context.sourceFiles || [];
    return values.map((entry) => {
        if (typeof entry === 'string') return entry;
        return entry.fsPath || entry.path || entry.relativePath || entry.uri?.fsPath || entry.uri?.path;
    }).filter(Boolean);
}

function schedulingConfig(context) {
    const value = context.scheduling || context.config?.scheduling || context.config || {};
    return {
        bscExecutable: value.bscExecutable || 'bsc',
        topModule: value.topModule || '',
        workingDirectory: value.workingDirectory || '.',
        arguments: Array.isArray(value.arguments) ? value.arguments : [],
        sourcePaths: Array.isArray(value.sourcePaths) ? value.sourcePaths : [],
        reportFiles: Array.isArray(value.reportFiles) ? value.reportFiles : [],
        timeoutMs: Number.isFinite(value.timeoutMs) ? value.timeoutMs : 30000
    };
}

function workspaceRoot(context) {
    return context.workspacePath
        || context.rootPath
        || context.folder?.uri?.fsPath
        || context.workspaceFolder?.uri?.fsPath
        || process.cwd();
}

function isWorkspaceTrusted(context) {
    if (typeof context.workspaceTrusted === 'boolean') return context.workspaceTrusted;
    if (typeof context.isTrusted === 'boolean') return context.isTrusted;
    if (typeof context.workspace?.isTrusted === 'boolean') return context.workspace.isTrusted;
    if (typeof context.trusted === 'boolean') return context.trusted;
    return true;
}

function unavailable(reason, diagnostics = []) {
    return { provider: 'bsc', available: false, relations: [], diagnostics, reason };
}

function blockedDiagnostic(message) {
    return { severity: 'warning', message, location: null };
}

function isCancelled(token) {
    return token?.isCancellationRequested === true || token?.aborted === true;
}

function subscribeCancellation(token, listener) {
    if (!token) return () => {};
    if (typeof token.onCancellationRequested === 'function') {
        const disposable = token.onCancellationRequested(listener);
        return () => disposable?.dispose?.();
    }
    if (typeof token.addEventListener === 'function') {
        token.addEventListener('abort', listener, { once: true });
        return () => token.removeEventListener('abort', listener);
    }
    return () => {};
}

function runWithSpawn(spawn, executable, argv, options, output) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(executable, argv, { cwd: options.cwd, windowsHide: true });
        } catch (error) {
            resolve({ error, code: null, stdout: '', stderr: '' });
            return;
        }
        let stdout = '';
        let stderr = '';
        let settled = false;
        let cancelled = false;
        let timedOut = false;
        let timer;
        let unsubscribe = () => {};
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubscribe();
            resolve({ stdout, stderr, cancelled, timedOut, ...result });
        };
        child.stdout?.on('data', (chunk) => { stdout += chunk; output(String(chunk)); });
        child.stderr?.on('data', (chunk) => { stderr += chunk; output(String(chunk)); });
        child.once('error', (error) => finish({ error, code: null }));
        child.once('close', (code, signal) => finish({ code, signal }));
        const stop = (timeout) => {
            if (timeout) timedOut = true;
            else cancelled = true;
            child.kill?.('SIGTERM');
            finish({ code: null });
        };
        unsubscribe = subscribeCancellation(options.token, () => stop(false));
        timer = setTimeout(() => stop(true), options.timeoutMs);
        if (isCancelled(options.token)) stop(false);
    });
}

function runWithExecFile(execFile, executable, argv, options, output) {
    return new Promise((resolve) => {
        let settled = false;
        let handle;
        let timer;
        let unsubscribe = () => {};
        const finish = (error, stdout = '', stderr = '') => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubscribe();
            output(String(stdout || ''));
            output(String(stderr || ''));
            resolve({
                error: error || null,
                code: error ? (error.code ?? null) : 0,
                stdout: String(stdout || ''),
                stderr: String(stderr || ''),
                cancelled: error?.cancelled === true,
                timedOut: error?.timedOut === true
            });
        };
        try {
            handle = execFile(executable, argv, { cwd: options.cwd, windowsHide: true }, finish);
            if (handle && typeof handle.then === 'function') {
                handle.then(
                    (value) => finish(null, value?.stdout ?? value ?? '', value?.stderr ?? ''),
                    (error) => finish(error, error?.stdout, error?.stderr)
                );
            }
        } catch (error) {
            finish(error);
            return;
        }
        if (settled) return;
        const stop = (timedOut) => {
            handle?.kill?.('SIGTERM');
            const error = new Error(timedOut ? 'Process timed out.' : 'Process cancelled.');
            error.timedOut = timedOut;
            error.cancelled = !timedOut;
            finish(error);
        };
        unsubscribe = subscribeCancellation(options.token, () => stop(false));
        timer = setTimeout(() => stop(true), options.timeoutMs);
        if (isCancelled(options.token)) stop(false);
    });
}

function callReadFile(readFile, filePath) {
    if (readFile.length >= 3) {
        return new Promise((resolve, reject) => readFile(filePath, 'utf8', (error, value) => error ? reject(error) : resolve(value)));
    }
    return Promise.resolve(readFile(filePath, 'utf8'));
}

module.exports = {
    BscScheduleProvider,
    buildBscArguments,
    parseBscSchedule: parseBscScheduleReport,
    parseBscScheduleReport,
    parseScheduleReport: parseBscScheduleReport
};
