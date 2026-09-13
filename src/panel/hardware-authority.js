'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { failure } = require('../hardware/json');
const { isPathInsideWorkspace } = require('../security/workspace-boundary');
async function grantDirectory(value) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw failure('PATH_DENIED', 'Select an absolute local directory');
    const resolved = await fs.realpath(value), stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw failure('PATH_DENIED', 'Selected root is not a directory');
    return Object.freeze({ path: resolved, dev: stat.dev, ino: stat.ino });
}
async function verifyDirectoryGrant(grant) {
    if (!grant || typeof grant.path !== 'string') throw failure('PATH_DENIED', 'Directory grant is missing');
    const current = await grantDirectory(grant.path);
    if (current.path !== grant.path || current.dev !== grant.dev || current.ino !== grant.ino)
        throw failure('PATH_DENIED', 'Approved directory was replaced; choose it again');
    return grant;
}
async function grantSubdirectory(base, relative) {
    await verifyDirectoryGrant(base);
    if (relative === '.') return base;
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\')
        || relative.split('/').some(part => !part || part === '.' || part === '..')) throw failure('PATH_DENIED', 'Source folder must remain inside the approved root');
    let requested = base.path;
    for (const part of relative.split('/')) {
        requested = path.join(requested, part);
        const stat = await fs.lstat(requested);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure('PATH_DENIED', 'Source folder cannot traverse a symlink');
    }
    const grant = await grantDirectory(requested);
    if (!isPathInsideWorkspace(base.path, grant.path)) throw failure('PATH_DENIED', 'Source folder escaped the approved root');
    await verifyDirectoryGrant(base); return grant;
}
module.exports = { grantDirectory, grantSubdirectory, verifyDirectoryGrant };
