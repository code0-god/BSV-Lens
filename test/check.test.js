'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const forbiddenBrandTokens = [
    String.fromCharCode(65, 81, 117, 65),
    String.fromCharCode(97, 113, 117, 97, 66, 115, 118, 65, 114, 99, 104),
    String.fromCharCode(97, 113, 117, 97, 45, 98, 115, 118, 45, 97, 114, 99, 104, 105, 116, 101, 99, 116, 117, 114, 101, 45, 101, 120, 112, 108, 111, 114, 101, 114)
];
const captureRoot = 'docs/hardware/evidence/g4-fix/run-regression/full-suite';

test('checker separates archived command output from current branding', async (t) => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-check-'));
    t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
    for (const relativePath of ['src', 'media', 'scripts', 'examples', 'package.json', 'README.md', 'LICENSE']) {
        fs.cpSync(path.join(root, relativePath), path.join(workspace, relativePath), {
            recursive: true,
            filter: (source) => path.basename(source) !== 'node_modules'
        });
    }

    function check() {
        const result = spawnSync(process.execPath, ['--no-global-search-paths', 'scripts/check.js'], {
            cwd: workspace,
            encoding: 'utf8',
            timeout: 60_000
        });
        assert.ifError(result.error);
        assert.equal(result.signal, null);
        return result;
    }

    function addFile(subtest, relativePath, content) {
        const filePath = path.join(workspace, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        subtest.after(() => fs.rmSync(filePath));
    }

    await t.test('unmodified isolated repository passes', () => {
        const result = check();
        assert.equal(result.status, 0, result.stderr);
    });

    await t.test('archived stdout and stderr retain forbidden tokens', (subtest) => {
        const content = `${forbiddenBrandTokens.join('\n')}\n`;
        for (const stream of ['stdout', 'stderr']) addFile(subtest, `${captureRoot}/${stream}.log`, content);
        const result = check();
        assert.equal(result.status, 0, result.stderr);
        for (const stream of ['stdout', 'stderr']) {
            assert.equal(fs.readFileSync(path.join(workspace, captureRoot, `${stream}.log`), 'utf8'), content);
        }
    });

    for (const relativePath of ['src/branding-regression.js', 'docs/branding-regression.md']) {
        for (const [index, token] of forbiddenBrandTokens.entries()) {
            await t.test(`${relativePath} rejects forbidden token ${index}`, (subtest) => {
                addFile(subtest, relativePath, `// ${token}\n`);
                const result = check();
                assert.equal(result.status, 1, result.stderr);
                assert.match(result.stderr, /ERR_ASSERTION/);
                assert.ok(result.stderr.includes(relativePath), result.stderr);
            });
        }
    }

    for (const relativePath of [
        'test/branding-regression.test.js',
        'src/stdout.log',
        'docs/hardware/evidence-copy/stdout.log',
        `${captureRoot}/README.md`,
        `${captureRoot}/branding-regression.js`
    ]) {
        await t.test(`${relativePath} is not exempt from branding`, (subtest) => {
            addFile(subtest, relativePath, `// ${forbiddenBrandTokens[0]}\n`);
            const result = check();
            assert.equal(result.status, 1, result.stderr);
            assert.match(result.stderr, /ERR_ASSERTION/);
            assert.ok(result.stderr.includes(relativePath), result.stderr);
        });
    }

    await t.test('external workspace data needs an exact hash-bound G6 index role', (subtest) => {
        const directory = 'docs/hardware/evidence/g6/run-external-regression';
        const content = JSON.stringify({ workspace: forbiddenBrandTokens[0] });
        addFile(subtest, `${directory}/native-receipt.json`, content);
        assert.equal(check().status, 1, 'Unindexed external data must remain checked');
        const row = { path: 'native-receipt.json', role: 'external-workspace-data', bytes: Buffer.byteLength(content),
            sha256: require('node:crypto').createHash('sha256').update(content).digest('hex') };
        addFile(subtest, `${directory}/index.json`, JSON.stringify({ schema: 'g6-evidence-v1', files: [row] }));
        assert.equal(check().status, 0, 'Indexed external workspace name is data, not product branding');
        fs.appendFileSync(path.join(workspace, directory, 'native-receipt.json'), ' ');
        assert.equal(check().status, 1, 'Modified indexed data loses the exception');
    });

    await t.test('raw native JSONL permits only the indexed external workspace name', (subtest) => {
        const directory = 'docs/hardware/evidence/g6/run-jsonl-regression', name = 'native-events.jsonl';
        const content = `${JSON.stringify({ workspace: forbiddenBrandTokens[0], event: 'editorSelection' })}\n${JSON.stringify({ event: 'sourceReveal' })}\n`;
        const file = path.join(workspace, directory, name), indexFile = path.join(workspace, directory, 'index.json');
        const descriptor = (path, text, role = 'external-workspace-data') => ({ path, role, bytes: Buffer.byteLength(text),
            sha256: require('node:crypto').createHash('sha256').update(text).digest('hex') });
        const row = descriptor(name, content), index = files => JSON.stringify({ schema: 'g6-evidence-v1', files });
        addFile(subtest, `${directory}/${name}`, content);
        assert.equal(check().status, 1, 'Unindexed JSONL remains checked');
        addFile(subtest, `${directory}/index.json`, index([row]));
        assert.equal(check().status, 0, 'Exact indexed raw JSONL must pass');
        assert.equal(fs.readFileSync(file, 'utf8'), content, 'Checker must not rewrite JSONL');
        for (const invalid of [{ ...row, role: 'native-log' }, { ...row, sha256: '0'.repeat(64) }]) {
            fs.writeFileSync(indexFile, index([invalid])); assert.equal(check().status, 1, 'Wrong role/hash must fail');
        }
        fs.writeFileSync(indexFile, index([row])); fs.appendFileSync(file, '\n');
        assert.equal(check().status, 1, 'Changed raw JSONL must fail'); fs.writeFileSync(file, content);
        const legacyContent = `${JSON.stringify({ workspace: forbiddenBrandTokens[1] })}\n`;
        fs.writeFileSync(file, legacyContent); fs.writeFileSync(indexFile, index([descriptor(name, legacyContent)]));
        assert.equal(check().status, 1, 'Other legacy branding remains forbidden even in indexed JSONL');
        fs.writeFileSync(file, content);
        for (const extension of ['js', 'log']) {
            const extra = `arbitrary.${extension}`, relative = `${directory}/${extra}`, extraFile = path.join(workspace, relative);
            const text = `// ${forbiddenBrandTokens[0]}\n`; fs.writeFileSync(extraFile, text);
            subtest.after(() => { if (fs.existsSync(extraFile)) fs.rmSync(extraFile); });
            fs.writeFileSync(indexFile, index([row, descriptor(extra, text)]));
            const result = check(); assert.equal(result.status, 1); assert.ok(result.stderr.includes(relative), result.stderr);
            fs.rmSync(extraFile);
        }
    });

    await t.test('usability external data requires its own exact schema, role and unchanged bytes', (subtest) => {
        const directory = 'docs/hardware/evidence/g6-usability/run-data-regression';
        const content = JSON.stringify({ workspace: forbiddenBrandTokens[0] });
        const row = { path: 'source-inventory.json', role: 'external-workspace-data', bytes: Buffer.byteLength(content),
            sha256: require('node:crypto').createHash('sha256').update(content).digest('hex') };
        addFile(subtest, `${directory}/${row.path}`, content);
        const indexFile = path.join(workspace, directory, 'index.json');
        addFile(subtest, `${directory}/index.json`, JSON.stringify({ schema: 'g6-evidence-v1', files: [row] }));
        assert.equal(check().status, 1, 'A historical G6 schema cannot authorize the new evidence root');
        fs.writeFileSync(indexFile, JSON.stringify({ schema: 'g6-usability-evidence-v1', files: [row] }));
        assert.equal(check().status, 0);
        fs.appendFileSync(path.join(workspace, directory, row.path), ' ');
        assert.equal(check().status, 1, 'Changed usability evidence remains a failure');
    });

    await t.test('only the hash-bound usability visual report may name its actual workspace', (subtest) => {
        const directory = 'docs/hardware/evidence/g6-usability/run-visual-regression';
        const content = `# Actual workspace visual review\n${forbiddenBrandTokens[0]}\n`;
        const row = { path: 'visual/FINAL_VISUAL_REVIEW.md', bytes: Buffer.byteLength(content),
            sha256: require('node:crypto').createHash('sha256').update(content).digest('hex') };
        const file = path.join(workspace, directory, row.path), indexFile = path.join(workspace, directory, 'index.json');
        addFile(subtest, `${directory}/${row.path}`, content);
        assert.equal(check().status, 1, 'Unindexed authored evidence remains checked');
        addFile(subtest, `${directory}/index.json`, JSON.stringify({ schema: 'g6-usability-evidence-v1', files: [row] }));
        assert.equal(check().status, 0);
        fs.appendFileSync(file, 'changed'); assert.equal(check().status, 1, 'A changed report cannot inherit approval');
        fs.writeFileSync(file, content);
        const other = `${directory}/arbitrary.md`;
        addFile(subtest, other, content);
        fs.writeFileSync(indexFile, JSON.stringify({ schema: 'g6-usability-evidence-v1', files: [row,
            { ...row, path: 'arbitrary.md', role: 'external-workspace-data' }] }));
        assert.equal(check().status, 1, 'General authored documents remain subject to branding validation');
    });

    await t.test('JavaScript in evidence still receives syntax validation', (subtest) => {
        const relativePath = `${captureRoot}/syntax-regression.js`;
        addFile(subtest, relativePath, 'const = ;\n');
        const result = check();
        assert.equal(result.status, 1, result.stderr);
        assert.ok(result.stderr.includes(relativePath), result.stderr);
        assert.match(result.stderr, /SyntaxError/);
    });
});
