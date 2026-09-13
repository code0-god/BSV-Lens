'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function verifyInventory(workspace, inventory) {
    return inventory.every(row => { const bytes = fs.readFileSync(path.join(workspace, row.path)); return bytes.length === row.bytes && digest(bytes) === row.sha256; });
}
function prepare(fixturePath, output) {
    const bytes = fs.readFileSync(fixturePath), original = JSON.parse(bytes);
    assert.equal(original.schema, 'g6-native-fixtures-v1'); assert.equal(original.status, 'pass');
    assert.ok(verifyInventory(original.workspace, original.inventory), 'Original fixture inventory differs');
    const privateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'g6-security-input-')));
    const relative = path.relative(path.resolve(__dirname, '../../..'), privateRoot);
    assert.ok(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'Restricted test inputs must be outside the product repository');
    const workspace = path.join(privateRoot, 'security-workspace'); fs.mkdirSync(workspace);
    for (const row of original.inventory) {
        const target = path.join(workspace, row.path); fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(original.workspace, row.path), target, fs.constants.COPYFILE_EXCL);
    }
    const fixtures = {};
    for (const [key, value] of Object.entries(original.fixtures)) {
        const { origin, ...manifest } = structuredClone(value.manifest), manifestRelative = `security-${key}-stock.json`;
        json(path.join(workspace, manifestRelative), manifest);
        fixtures[key] = { ...value, manifest, manifestRelative, workspaceRootChoice: path.basename(workspace),
            sourceRootChoice: path.basename(workspace), sourceRelative: '.',
            sourceFiles: value.sourceFiles.map(source => ({ ...source, path: path.join(workspace, path.relative(original.workspace, source.path)) })),
            artifact: path.join(workspace, path.relative(original.workspace, value.artifact)) };
    }
    const outside = path.join(privateRoot, 'unapproved-outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'Outside.bsv'), 'package Outside; module mkOutside(Empty); endmodule endpackage');
    fs.copyFileSync(fixtures.A.artifact, path.join(outside, 'design.json'), fs.constants.COPYFILE_EXCL);
    fs.symlinkSync(outside, path.join(workspace, 'source-escape'));
    fs.symlinkSync(path.join(outside, 'design.json'), path.join(workspace, 'artifact-escape.json'));
    json(path.join(workspace, 'traversal.json'), { version: 1, sources: [{ path: '../unapproved-outside/Outside.bsv' }] });
    const mutation = structuredClone(fixtures.A), mutationDirectory = path.join(workspace, 'mutation'); fs.mkdirSync(mutationDirectory);
    fs.copyFileSync(mutation.sourceFiles[0].path, path.join(mutationDirectory, 'Source.bsv'), fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(mutation.artifact, path.join(mutationDirectory, 'design.json'), fs.constants.COPYFILE_EXCL);
    mutation.manifest.label = 'Explicit isolated mutation case'; mutation.manifest.sources[0].path = 'mutation/Source.bsv';
    mutation.manifest.artifact.path = 'mutation/design.json'; mutation.manifestRelative = 'mutation.json';
    mutation.sourceFiles[0].path = path.join(mutationDirectory, 'Source.bsv'); mutation.artifact = path.join(mutationDirectory, 'design.json');
    json(path.join(workspace, mutation.manifestRelative), mutation.manifest);
    const syntheticDirectory = path.join(workspace, 'synthetic'); fs.mkdirSync(syntheticDirectory);
    const sourceText = `package Hostile;\nmodule mkHostile(Empty);\n Reg#(Bit#(8)) state <- mkReg(0);\n rule advance;\n  $display("<svg onload='globalThis.__g6Executed=true'>");\n  state <= state + 1;\n endrule\nendmodule\nendpackage\n`;
    const source = path.join(syntheticDirectory, 'Hostile.bsv'); fs.writeFileSync(source, sourceText, { flag: 'wx' });
    const synthetic = { key: 'synthetic-security-only', workspaceRootChoice: path.basename(workspace),
        manifestRelative: 'synthetic.json', sourceFiles: [{ path: source, pathRef: 'synthetic/Hostile.bsv', contentHash: digest(sourceText) }],
        manifest: { version: 1, label: "Security <img src=x onerror='globalThis.__g6Executed=true'>",
            sources: [{ path: 'synthetic/Hostile.bsv', contentHash: digest(sourceText) }] } };
    json(path.join(workspace, synthetic.manifestRelative), synthetic.manifest);
    const secondWorkspace = path.join(privateRoot, 'independent-project'); fs.mkdirSync(secondWorkspace);
    const workspaceFile = path.join(privateRoot, 'security.code-workspace');
    json(workspaceFile, { folders: [{ path: path.basename(workspace) }, { path: path.basename(secondWorkspace) }] });
    const result = { original, fixturePath: path.resolve(fixturePath), fixtureSha256: digest(bytes), privateRoot, workspace, workspaceFile,
        fixtures, mutation, synthetic, secondWorkspace, outside, originalInventory: original.inventory,
        placementReason: 'A test workspace below the product/VS Code installation ancestor was implicitly trusted by Code. An isolated private temporary root outside that ancestor is required to observe actual Restricted Mode.',
        contract: 'Original captured inputs never mutate. Only mutation/* and synthetic/* are writable test inputs. Symlink targets are isolated unapproved test files.' };
    json(path.join(output, 'security-inputs.json'), { ...result, original: { workspace: original.workspace, inventory: original.inventory } });
    return result;
}
function inventory(root) {
    const rows = [];
    function walk(directory) {
        for (const name of fs.readdirSync(directory).sort()) {
            const file = path.join(directory, name), stat = fs.lstatSync(file), relative = path.relative(root, file).split(path.sep).join('/');
            if (stat.isDirectory()) walk(file);
            else if (stat.isSymbolicLink()) {
                const target = fs.readlinkSync(file); rows.push({ path: relative, kind: 'symlink', target, sha256: digest(target) });
            } else {
                assert.ok(stat.isFile(), 'Security input retention permits only files, directories and test symlinks');
                const bytes = fs.readFileSync(file); rows.push({ path: relative, kind: 'file', bytes: bytes.length, sha256: digest(bytes) });
            }
        }
    }
    walk(root); return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function retain(inputs, output, nativeShutdown = null) {
    const retainedRoot = path.join(output, 'security-inputs-retained'), before = inventory(inputs.privateRoot);
    assert.equal(fs.existsSync(retainedRoot), false, 'Retained security inputs already exist');
    fs.cpSync(inputs.privateRoot, retainedRoot, { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true });
    const after = inventory(retainedRoot); assert.deepEqual(after, before, 'Retained inputs differ from the actual validation inputs');
    const result = { schema: 'g6-security-input-retention-v1', validatedRoot: inputs.privateRoot, retainedRoot,
        validatedWorkspace: inputs.workspace, retainedWorkspace: path.join(retainedRoot, path.basename(inputs.workspace)),
        fingerprint: digest(JSON.stringify(before)), inventory: before, nativeShutdown,
        retentionTrigger: nativeShutdown ? 'native-process-exited' : 'no-native-process-returned',
        originalCapturedPreserved: verifyInventory(inputs.original.workspace, inputs.original.inventory),
        validatedCapturedPreserved: verifyInventory(inputs.workspace, inputs.original.inventory),
        retainedCapturedPreserved: verifyInventory(path.join(retainedRoot, path.basename(inputs.workspace)), inputs.original.inventory),
        policy: 'Byte-identical copy after native shutdown. Original private test paths remain available; symlinks are preserved as links and never followed while retaining evidence.' };
    json(path.join(output, 'security-input-retention.json'), result); return result;
}
module.exports = { prepare, retain, verifyInventory, digest, json };
