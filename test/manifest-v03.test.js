'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('extension identity and command IDs remain stable', () => {
    assert.equal(manifest.version, '0.3.0');
    assert.equal(`${manifest.publisher}.${manifest.name}`, 'code0-god.bsv-architecture-explorer');
    const commands = new Set(manifest.contributes.commands.map((item) => item.command));
    for (const id of [
        'bsvArchitecture.openWorkspace',
        'bsvArchitecture.openCurrentFile',
        'bsvArchitecture.openSymbol',
        'bsvArchitecture.refresh',
        'bsvArchitecture.createConfig',
        'bsvArchitecture.exportJson'
    ]) assert.ok(commands.has(id), `missing command ${id}`);
});

test('v0.3 view settings are registered with safe defaults', () => {
    const settings = manifest.contributes.configuration.properties;
    const expected = {
        'bsvArchitecture.defaultSourceScope': 'workspace',
        'bsvArchitecture.defaultLevel': 'system',
        'bsvArchitecture.defaultMode': 'structure',
        'bsvArchitecture.defaultHopScope': 'all',
        'bsvArchitecture.syncWithEditor': true,
        'bsvArchitecture.showMethodPorts': true,
        'bsvArchitecture.collapseModuleMembers': true,
        'bsvArchitecture.includePotentialScheduleDependencies': true
    };
    for (const [key, value] of Object.entries(expected)) {
        assert.ok(settings[key], `missing setting ${key}`);
        assert.equal(settings[key].default, value);
    }
    assert.match(settings['bsvArchitecture.defaultView'].deprecationMessage, /defaultSourceScope/);
    assert.ok(settings['bsvArchitecture.showPrimitives']);
});
