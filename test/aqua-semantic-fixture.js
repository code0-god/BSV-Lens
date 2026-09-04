'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeConfig } = require('../src/architecture/config');
const { parseBsvFile } = require('../src/architecture/parser');
const { buildSemanticModel } = require('../src/architecture/semantic/model');
const { assertAquaFixture } = require('../scripts/aqua-fixture');

let cached = null;

function buildAquaSemanticModel() {
    if (cached) return cached;
    const fixture = assertAquaFixture(process.env.AQUA_WORKSPACE);
    const sourceRoot = path.join(fixture.root, 'hw', 'bsv', 'src');
    const parsedFiles = filesBelow(sourceRoot)
        .filter((filePath) => filePath.endsWith('.bsv'))
        .sort()
        .map((filePath) => parseBsvFile(fs.readFileSync(filePath, 'utf8'), {
            uri: `file://${filePath}`,
            relativePath: path.relative(fixture.root, filePath).replace(/\\/g, '/')
        }));
    const model = buildSemanticModel(parsedFiles, normalizeConfig({
        entrypoints: ['mkAquaLoopMatmul', 'mkAquaMemorySubsystem']
    }), {
        limits: { maxNodes: 10000, maxEdges: 25000 }
    });
    cached = { fixture, model };
    return cached;
}

function filesBelow(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const filePath = path.join(directory, entry.name);
        return entry.isDirectory() ? filesBelow(filePath) : [filePath];
    });
}

module.exports = {
    buildAquaSemanticModel
};
