'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// mkdtemp atomically owns a fresh directory, across processes and repeated runs.
async function createRunOutput(root, label) {
    const runs = path.join(root, '.build/hardware/runs');
    await fs.mkdir(runs, { recursive: true });
    return fs.mkdtemp(path.join(runs, `${label}-`));
}

module.exports = { createRunOutput };
