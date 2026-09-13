#!/usr/bin/env node
'use strict';
// Evidence projection of the existing Source/Semantic model, not another parser.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { parseBsvFile } = require('../../../src/architecture/parser');
const { buildSemanticModel } = require('../../../src/architecture/semantic/model');
const fixtures = [];
for (const [fixture, name, top] of [['A', 'Connected', 'mkConnected'],
    ['B', 'Control', 'mkControl'], ['C', 'Reuse', 'mkReuse']]) {
    const uri = `experiments/hardware/fixtures/${name}.bsv`;
    const text = fs.readFileSync(uri, 'utf8');
    const semantic = buildSemanticModel([parseBsvFile(text, { uri, relativePath: uri })],
        { entrypoints: [top] });
    const modules = semantic.instances.filter(item => !item.primitiveKind);
    const storage = semantic.instances.filter(item => item.primitiveKind === 'register');
    const moduleIds = new Set(modules.map(item => item.id));
    const behaviors = semantic.stateBehaviors.filter(item => moduleIds.has(item.ownerInstanceId));
    const contacts = semantic.endpoints.filter(item => item.kind === 'method-endpoint' &&
        moduleIds.has(item.ownerInstanceId));
    fixtures.push({ fixture, source: { path: uri, sha256: createHash('sha256').update(text).digest('hex') },
        entrypoint: top,
        counts: {
            sourceModuleOccurrencesIncludingRoots: modules.length,
            contextualStorageOccurrences: storage.length,
            contextualMethodBodies: behaviors.filter(item => item.kind === 'method').length,
            contextualRuleBodies: behaviors.filter(item => item.kind === 'rule').length,
            contextualBehaviors: behaviors.length,
            contextualMethodInterfaceContacts: contacts.length
        },
        occurrences: modules.map(item => ({ id: item.id, path: item.path,
            definitionId: item.targetDefinitionId,
            methodBodyIds: behaviors.filter(b => b.ownerInstanceId === item.id && b.kind === 'method').map(b => b.id),
            ruleBodyIds: behaviors.filter(b => b.ownerInstanceId === item.id && b.kind === 'rule').map(b => b.id),
            methodContactIds: contacts.filter(c => c.ownerInstanceId === item.id).map(c => c.id) }))
    });
}
console.log(JSON.stringify({ schema: 'g1-bsv-source-populations-v1',
    provider: 'Existing parseBsvFile + buildSemanticModel with explicit fixture entrypoints',
    scope: 'Source-derived contextual populations; no compiler provenance upgrade', fixtures }, null, 2));
