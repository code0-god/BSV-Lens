#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseSourceDocuments } = require('../../../src/hardware/correspondence/source');
const { buildSemanticModel } = require('../../../src/architecture/semantic/model');
const { createRun } = require('../g6/run.cjs');

const DEFAULT_WORKSPACE = path.join(os.homedir(), 'aisa-lab/DynDNN/IM2P/IM2P.sim');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (output, name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const expect = (value, message) => assert.ok(value, message);

function parseArguments(argv) {
    if (argv.includes('--help')) return { help: true };
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const key = { '--workspace': 'workspace', '--output': 'output' }[argv[index]];
        assert.ok(key && argv[index + 1] && !argv[index + 1].startsWith('--'), `Unknown or incomplete argument: ${argv[index]}`);
        assert.equal(options[key], undefined, `Duplicate argument: ${argv[index]}`);
        options[key] = argv[++index];
    }
    options.workspace ||= process.env.IM2P_WORKSPACE || DEFAULT_WORKSPACE;
    options.output ||= process.env.G6_OUTPUT_DIR || createRun('im2p-core');
    return options;
}
function sourceDocuments(workspace) {
    const sourceRoot = path.join(workspace, 'src'), documents = [];
    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(file);
            else if (entry.isFile() && entry.name.endsWith('.bsv')) {
                const text = fs.readFileSync(file, 'utf8'), pathRef = path.relative(workspace, file), revision = hash(text);
                documents.push({ pathRef, text, contentHash: revision, revision });
            }
        }
    };
    visit(sourceRoot); return documents;
}
function moduleDefinition(model, name) {
    const definitions = model.definitions.filter(item => item.kind === 'module-definition' && item.name === name);
    assert.equal(definitions.length, 1, `Expected one module definition for ${name}`);
    return definitions[0];
}
function declaration(definition, name) {
    const items = definition.childInstanceDeclarations.filter(item => item.name === name);
    assert.equal(items.length, 1, `Expected one ${definition.name}.${name} declaration`);
    return items[0];
}
function dimensions(family) {
    return family.dimensions.map(item => item.expression);
}
function family(declaration, expected) {
    expect(declaration.family, `${declaration.name} must retain family metadata`);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(declaration.family[key], value, `${declaration.name}.${key}`);
    return declaration;
}
function caseBoundaries(model, documents) {
    const byPath = new Map(documents.map(document => [document.pathRef, document]));
    const cases = model.statements.filter(statement => statement.kind === 'case');
    expect(cases.length > 0, 'Semantic model contains no case statements');
    return cases.map(statement => {
        const source = byPath.get(statement.sourceDocumentId);
        expect(source, `Missing source for ${statement.id}`);
        expect(statement.caseArms.length > 0, `Case ${statement.id} has no arms`);
        const arms = statement.caseArms.map(arm => {
            assert.ok(arm.range.start >= statement.range.start && arm.range.end <= statement.range.end && arm.range.end > arm.range.start,
                `Case arm range escapes ${statement.id}`);
            assert.equal(source.text.slice(arm.range.start, arm.range.end), arm.text, `Case arm text differs for ${arm.id}`);
            return { id: arm.id, kind: arm.kind, range: arm.range, sourceRange: arm.sourceRange,
                labels: arm.labelExpressionIds, bodyStatementIds: arm.bodyStatementIds, resolutionStatus: arm.resolutionStatus };
        });
        return { id: statement.id, source: statement.sourceDocumentId, range: statement.range, sourceRange: statement.sourceRange,
            mode: statement.caseMode, arms };
    });
}

function run(options) {
    const workspace = fs.realpathSync(options.workspace), output = path.resolve(options.output);
    assert.equal(path.basename(output), 'g6', 'Output must be a unique G6 run directory');
    assert.ok(fs.statSync(workspace).isDirectory(), 'IM2P workspace must be a directory');
    fs.mkdirSync(output, { recursive: true });
    const documents = sourceDocuments(workspace);
    expect(documents.length > 0, 'IM2P src contains no BSV sources');
    const before = documents.map(({ text, ...identity }) => identity);
    const parsed = parseSourceDocuments(documents);
    const semantic = buildSemanticModel(parsed, { entrypoints: ['mkIM2PCore', 'mkPE', 'mkVectorUnit'] });

    const systolic = moduleDefinition(semantic, 'mkSystolicArray');
    const processingElements = family(declaration(systolic, 'processingElements'), {
        kind: 'module-family', generatorDepth: 2, leafConstructor: 'mkPE', elementExpansion: 'lazy'
    });
    assert.deepEqual(dimensions(processingElements.family), ['arrayDim', 'arrayDim']);
    assert.equal(processingElements.multiplicity.expression, 'arrayDim * arrayDim');
    const loadedRows = family(declaration(systolic, 'loadedRows'), {
        kind: 'storage-family', generatorDepth: 2, leafConstructor: 'mkReg', elementExpansion: 'lazy'
    });
    assert.deepEqual(dimensions(loadedRows.family), ['2', 'arrayDim']);
    assert.equal(loadedRows.multiplicity.expression, '2 * arrayDim');

    const pe = moduleDefinition(semantic, 'mkPE');
    const weightRegs = family(declaration(pe, 'weightRegs'), {
        kind: 'storage-family', generatorDepth: 1, leafConstructor: 'mkRegU', resolutionStatus: 'exact'
    });
    const weightValidRegs = family(declaration(pe, 'weightValidRegs'), {
        kind: 'storage-family', generatorDepth: 1, leafConstructor: 'mkReg', resolutionStatus: 'exact'
    });
    for (const item of [weightRegs, weightValidRegs]) {
        assert.deepEqual(dimensions(item.family), ['2']); assert.equal(item.primitiveKind, 'register');
        assert.equal(item.family.elementExpansion, 'lazy');
    }
    const groupIndexReg = declaration(moduleDefinition(semantic, 'mkVectorUnit'), 'groupIndexReg');
    assert.equal(groupIndexReg.primitiveKind, 'register'); assert.equal(groupIndexReg.family, null);
    assert.equal(groupIndexReg.multiplicity, null); assert.equal(groupIndexReg.constructor, 'mkReg');

    const receipt = { schema: 'g6-im2p-core-receipt-v1', status: 'pass', startedAt: new Date().toISOString(), workspace,
        sources: { count: documents.length, files: before, fingerprint: hash(JSON.stringify(before)) },
        parser: { files: parsed.length, diagnostics: parsed.flatMap(file => file.diagnostics || []) },
        semantic: { definitions: semantic.definitions.length, instances: semantic.instances.length, statements: semantic.statements.length,
            diagnostics: semantic.diagnostics },
        families: { processingElements, loadedRows, weightRegs, weightValidRegs, groupIndexReg },
        caseArmBoundaries: caseBoundaries(semantic, documents) };
    const after = sourceDocuments(workspace).map(({ text, ...identity }) => identity);
    receipt.sourcePreserved = JSON.stringify(before) === JSON.stringify(after);
    assert.equal(receipt.sourcePreserved, true, 'Receipt runner changed an IM2P source file');
    receipt.finishedAt = new Date().toISOString();
    write(output, 'core-receipt.json', receipt);
    console.log(JSON.stringify({ output, status: receipt.status, sources: receipt.sources.count, cases: receipt.caseArmBoundaries.length }));
    return receipt;
}

if (require.main === module) {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log('node experiments/hardware/g6-im2p/core-receipt.cjs [--workspace IM2P.sim] [--output UNIQUE_RUN/g6]');
    else {
        try { run(options); } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
    }
}

module.exports = { run, parseArguments, sourceDocuments, caseBoundaries };
