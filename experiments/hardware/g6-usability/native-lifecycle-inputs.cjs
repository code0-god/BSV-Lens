'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const types = 'package Types; function Bit#(8) increment(Bit#(8) value); return value + 1; endfunction endpackage\n';
const design = `package Control;
interface Stage;
    method Action put(Bit#(8) value);
    method Bit#(8) get;
endinterface
module mkLeaf(Stage);
    Reg#(Bit#(8)) state <- mkReg(0);
    rule advance; state <= state + 1; endrule
    method Action put(Bit#(8) value); state <= value; endmethod
    method Bit#(8) get = state;
endmodule
module mkController(Empty);
    Stage west <- mkLeaf;
    Stage east <- mkLeaf;
    rule transfer; east.put(west.get); endrule
endmodule
endpackage
`;
const maintenance = 'package Service; module mkMaintenance(Empty); Reg#(Bool) pending <- mkReg(False); endmodule endpackage\n';

function prepare(output) {
    const root = path.join(output, 'isolated-inputs'); fs.mkdirSync(root);
    const main = path.join(root, 'sources-main'), other = path.join(root, 'sources-other'), artifacts = path.join(root, 'artifact-results');
    for (const folder of [main, other, artifacts]) fs.mkdirSync(folder);
    const changes = [];
    function write(relative, text, folder = main) {
        const file = path.join(folder, relative), rel = path.relative(root, file);
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Test mutation escaped its isolated fixture');
        const before = fs.existsSync(file) ? digest(fs.readFileSync(file)) : null;
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
        changes.push({ operation: 'write', relative: rel, before, after: digest(Buffer.from(text)), bytes: Buffer.byteLength(text), text });
        return file;
    }
    function remove(relative) {
        const file = path.join(main, relative); changes.push({ operation: 'delete', relative, before: digest(fs.readFileSync(file)) }); fs.unlinkSync(file);
    }
    function rename(from, to) {
        changes.push({ operation: 'rename', from, to, contentHash: digest(fs.readFileSync(path.join(main, from))) });
        fs.mkdirSync(path.dirname(path.join(main, to)), { recursive: true }); fs.renameSync(path.join(main, from), path.join(main, to));
    }
    let settingsFile = null;
    const settings = (extra = {}) => {
        if (!settingsFile) throw new Error('Attach the driver-owned isolated settings file first');
        const before = fs.readFileSync(settingsFile), value = { ...JSON.parse(before), 'bsvArchitecture.autoRefresh': true,
            'bsvArchitecture.hardwareAutoDiscover': true, 'bsvArchitecture.exclude': [], 'bsvArchitecture.hardwareInclude': [],
            'bsvArchitecture.maxSourceBytes': 4194304, 'bsvArchitecture.maxFiles': 256, ...extra };
        const text = JSON.stringify(value, null, 2); fs.writeFileSync(settingsFile, text);
        changes.push({ operation: 'isolated-user-settings', before: digest(before), after: digest(Buffer.from(text)), values: value });
    };
    write('deep/implementation/Control.bsv', design, other);
    const marker = path.join(root, 'SHOULD-NOT-EXECUTE');
    write('Makefile', `all:\n\ttouch ${marker}\n`); write('package.json', JSON.stringify({ scripts: { prepare: `touch ${marker}` } }));
    write('.vscode/tasks.json', JSON.stringify({ version: '2.0.0', tasks: [{ label: 'forbidden', type: 'shell', command: `touch ${marker}` }] }));
    for (const name of ['first.json', 'second.json']) fs.copyFileSync(path.resolve(__dirname, '../../../docs/hardware/evidence/toolchain/A/design.json'), path.join(artifacts, name));
    fs.writeFileSync(path.join(artifacts, 'malformed.json'), '{"modules":');
    fs.writeFileSync(path.join(artifacts, 'unrelated.json'), JSON.stringify({ task: `touch ${marker}` }));
    const workspaceFile = path.join(root, 'lifecycle.code-workspace');
    fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [main, other, artifacts].map(folder => ({ path: folder })) }, null, 2));
    return { root, main, other, artifacts, workspaceFile, marker, changes, write, remove, rename, settings,
        attachSettings(file, isolatedRoot) {
            if (path.dirname(path.dirname(fs.realpathSync(file))) !== fs.realpathSync(isolatedRoot)) throw new Error('Settings must belong to this driver profile');
            settingsFile = file; settings();
        },
        source: path.join(main, 'deep/implementation/Control.bsv'), sourceRelative: 'deep/implementation/Control.bsv', types, design, maintenance };
}
module.exports = { prepare, digest, design, types, maintenance };
