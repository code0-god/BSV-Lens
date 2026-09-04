'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('BSV Lens identity preserves command compatibility', () => {
    assert.equal(manifest.version, '0.3.1');
    assert.equal(manifest.name, 'bsv-lens');
    assert.equal(manifest.displayName, 'BSV Lens');
    assert.equal(
        manifest.description,
        'Architecture, data-flow, and rule scheduling explorer for Bluespec SystemVerilog.'
    );
    assert.equal(`${manifest.publisher}.${manifest.name}`, 'code0-god.bsv-lens');
    assert.equal(manifest.repository.url, 'https://github.com/code0-god/BSV-Lens.git');
    assert.equal(manifest.homepage, 'https://github.com/code0-god/BSV-Lens#readme');
    assert.equal(manifest.bugs.url, 'https://github.com/code0-god/BSV-Lens/issues');
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.icon, 'media/icon.png');
    assert.ok(manifest.keywords.includes('Bluespec'));
    const commands = new Set(manifest.contributes.commands.map((item) => item.command));
    for (const id of [
        'bsvArchitecture.openWorkspace',
        'bsvArchitecture.openCurrentFile',
        'bsvArchitecture.openSymbol',
        'bsvArchitecture.refresh',
        'bsvArchitecture.createConfig',
        'bsvArchitecture.exportJson'
    ]) assert.ok(commands.has(id), `missing command ${id}`);
    for (const command of manifest.contributes.commands) {
        assert.equal(command.category, 'BSV Lens');
        assert.match(command.title, /^BSV Lens:/);
    }
    for (const key of Object.keys(manifest.contributes.configuration.properties)) {
        assert.match(key, /^bsvArchitecture\./);
    }
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
