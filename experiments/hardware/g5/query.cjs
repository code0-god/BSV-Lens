'use strict';

const fs = require('node:fs');
const { createCatalog } = require('../g4/server');

async function main() {
    const [buildId, operation, value] = process.argv.slice(2);
    if (!buildId || !['context', 'query'].includes(operation) || process.argv.length > 5) {
        throw new Error('Usage: query.cjs BUILD context [stock|instrumented] | BUILD query REQUEST.json');
    }
    const catalog = await createCatalog();
    const query = catalog.find(item => item.getCatalogEntry().buildId === buildId);
    if (!query) throw new Error('Unknown registered build');
    if (operation === 'context') return query.getAnalysisContext(value || 'stock');
    if (!value) throw new Error('Request JSON path required');
    return query.analyze(JSON.parse(fs.readFileSync(value, 'utf8')));
}

if (require.main === module) main().then(result => {
    console.log(JSON.stringify(result, null, 2));
}).catch(error => { console.error(error.code || 'INVALID_INPUT', error.message); process.exitCode = 1; });
module.exports = { main };
