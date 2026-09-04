'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeConfig } = require('../src/architecture/config');
const { parseBsvFile } = require('../src/architecture/parser');
const { buildSemanticModel } = require('../src/architecture/semantic/model');

function buildSemanticSource(source, name = 'SemanticFixture.bsv', config = {}) {
    const parsed = parseBsvFile(source, {
        uri: `file:///${name}`,
        relativePath: name
    });
    return buildSemanticModel([parsed], normalizeConfig(config), {
        limits: { maxNodes: 1000, maxEdges: 2000 }
    });
}

function buildFlowFixture(config = { entrypoints: ['mkFlowTop'] }) {
    const fixturePath = path.join(
        __dirname,
        'fixtures',
        'semantic-workspace',
        'src',
        'SemanticFlowFixture.bsv'
    );
    return buildSemanticSource(
        fs.readFileSync(fixturePath, 'utf8'),
        'semantic-flow.bsv',
        config
    );
}

module.exports = {
    buildFlowFixture,
    buildSemanticSource
};
