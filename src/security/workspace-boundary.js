'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function isPathInsideWorkspace(workspacePath, candidatePath, pathApi = path) {
    const workspace = comparable(pathApi.resolve(workspacePath), pathApi);
    const candidate = comparable(pathApi.resolve(candidatePath), pathApi);
    const relative = pathApi.relative(workspace, candidate);
    return relative === ''
        || relative !== '..'
        && !relative.startsWith(`..${pathApi.sep}`)
        && !pathApi.isAbsolute(relative);
}

async function resolveWorkspacePath(workspacePath, value, options = {}) {
    const pathApi = options.pathApi || path;
    const realpath = options.realpath || fs.realpath;
    const workspace = pathApi.resolve(workspacePath);
    const base = pathApi.resolve(options.basePath || workspace);
    const candidate = pathApi.isAbsolute(value)
        ? pathApi.resolve(value)
        : pathApi.resolve(base, value);
    const workspaceRealPath = await realpathWithMissing(workspace, realpath, pathApi);
    const realPath = await realpathWithMissing(candidate, realpath, pathApi);
    return {
        path: realPath,
        requestedPath: candidate,
        workspaceRealPath,
        insideWorkspace: isPathInsideWorkspace(workspaceRealPath, realPath, pathApi)
    };
}

async function validateTrustedExternalPath(options) {
    const {
        workspacePath,
        basePath = workspacePath,
        value,
        workspaceTrusted,
        purpose = 'path',
        allowTrustedExternal = true,
        externalReason = defaultExternalReason(purpose),
        realpath,
        pathApi
    } = options;
    try {
        const resolved = await resolveWorkspacePath(workspacePath, value, {
            basePath,
            realpath,
            pathApi
        });
        if (resolved.insideWorkspace || workspaceTrusted === true && allowTrustedExternal) {
            return { allowed: true, reason: '', ...resolved };
        }
        return { allowed: false, reason: externalReason, ...resolved };
    } catch (error) {
        return {
            allowed: false,
            reason: `Cannot resolve ${purpose}: ${error.message}`,
            path: null,
            requestedPath: null,
            workspaceRealPath: null,
            insideWorkspace: false
        };
    }
}

async function realpathWithMissing(value, realpath, pathApi) {
    try {
        return await realpath(value);
    } catch (error) {
        if (!isMissing(error)) throw error;
        const parent = pathApi.dirname(value);
        if (parent === value) return pathApi.resolve(value);
        const realParent = await realpathWithMissing(parent, realpath, pathApi);
        return pathApi.join(realParent, pathApi.basename(value));
    }
}

function comparable(value, pathApi) {
    const normalized = pathApi.normalize(value);
    return pathApi === path.win32 ? normalized.toLowerCase() : normalized;
}

function defaultExternalReason(purpose) {
    if (purpose === 'schedule report') {
        return 'External schedule reports require a trusted workspace.';
    }
    if (purpose === 'BSC working directory') {
        return 'External BSC working directories require a trusted workspace.';
    }
    if (purpose === 'source file') {
        return 'External source files are unavailable in a restricted workspace.';
    }
    return `External ${purpose} requires a trusted workspace.`;
}

function isMissing(error) {
    return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
}

module.exports = {
    isPathInsideWorkspace,
    resolveWorkspacePath,
    validateTrustedExternalPath
};
