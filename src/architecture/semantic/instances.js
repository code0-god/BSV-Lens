'use strict';

const { instanceOccurrenceId } = require('./ids');
const { bindConstructorArguments } = require('./constructor-bindings');

const SOURCE_ORIGIN = 'Source-derived';
const ROOT_ORIGIN = 'Source-derived root projection';

function buildInstances(definitions, parsedFiles, config = {}, context = {}) {
    const modules = definitions.filter((item) => item.kind === 'module-definition');
    const byName = groupBy(modules, (item) => item.name);
    const importsByPackage = new Map(parsedFiles.map((file) => [
        file.packageName, new Set((file.imports || []).map((item) => item.package))
    ]));
    const diagnostics = [];
    const resolve = (owner, name, location) => resolveTarget(
        owner, name, byName, importsByPackage, diagnostics, location
    );
    const instantiated = new Set();
    for (const owner of modules) {
        for (const declaration of owner.childInstanceDeclarations || []) {
            const target = resolve(owner, targetConstructor(declaration), null);
            if (target) instantiated.add(target.id);
        }
    }

    const configuredEntries = config.entrypoints || [];
    const configured = configuredRoots(modules, configuredEntries, diagnostics);
    const uninstantiated = modules.filter((item) => !instantiated.has(item.id));
    let candidates = (configuredEntries.length ? configured : uninstantiated)
        .map((definition) => ({
            definition,
            reason: configuredEntries.length ? 'configured' : 'uninstantiated'
        }));
    if (!candidates.length && configuredEntries.length === 0) {
        candidates = modules.map((definition) => ({
            definition,
            reason: 'cycle-fallback'
        }));
    }
    const limits = expansionLimits(context.limits || {});
    const instances = [];
    const bindings = [];
    const roots = [];
    const queue = [];
    const rootNames = uniqueRootPaths(candidates.map((item) => item.definition));
    for (let index = 0; index < candidates.length; index += 1) {
        const { definition, reason } = candidates[index];
        if (instances.length >= limits.budget) {
            diagnostics.push(limitDiagnostic('instance.budget', definition.location,
                `Instance expansion reached the ${limits.budget}-occurrence budget.`));
            break;
        }
        const path = rootNames[index];
        const instance = rootInstance(definition, path, reason);
        instances.push(instance);
        roots.push({
            instanceId: instance.id,
            targetDefinitionId: definition.id,
            name: definition.name,
            path,
            reason,
            rootStatus: 'unbound',
            parentInstanceId: null,
            analysisOrigin: ROOT_ORIGIN,
            confidence: 'exact',
            evidence: {
                selectionReason: reason,
                path,
                targetDefinitionId: definition.id
            },
            location: definition.location || null,
            sourceRange: definition.sourceRange || null
        });
        queue.push({ instance, definition, ancestors: new Set([definition.id]), depth: 0 });
    }

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const branch = queue[cursor];
        if (branch.depth >= limits.depth) {
            branch.instance.expansionStatus = 'depth-cut';
            diagnostics.push(limitDiagnostic('instance.depth', branch.instance.location,
                `Instance expansion reached the depth limit at ${branch.instance.path}.`));
            continue;
        }
        const declarations = branch.definition.childInstanceDeclarations || [];
        const selected = declarations.slice(0, limits.breadth);
        if (selected.length < declarations.length) {
            diagnostics.push(limitDiagnostic('instance.breadth', branch.instance.location,
                `Instance expansion omitted ${declarations.length - selected.length} children of ${branch.instance.path}.`));
        }
        const siblings = new Map();
        const childBranches = [];
        const bindable = [];
        const names = uniqueChildNames(selected);
        for (let index = 0; index < selected.length; index += 1) {
            const declaration = selected[index];
            if (instances.length >= limits.budget) {
                diagnostics.push(limitDiagnostic('instance.budget', declaration.location,
                    `Instance expansion reached the ${limits.budget}-occurrence budget.`));
                break;
            }
            const target = resolve(
                branch.definition,
                targetConstructor(declaration),
                declaration.primitiveKind ? null : declaration.location
            );
            const path = `${branch.instance.path}.${names[index]}`;
            const cycle = target && branch.ancestors.has(target.id);
            const child = childInstance(branch.instance, declaration, target, path, cycle);
            instances.push(child);
            if (!siblings.has(declaration.name)) siblings.set(declaration.name, child);
            if (target) bindable.push({ instance: child, definition: target });
            if (cycle) {
                diagnostics.push({
                    code: 'instance.cycle',
                    severity: 'error',
                    message: `Instance ${path} would recursively instantiate ${target.name}; expansion was cut.`,
                    location: declaration.location || target.location || null,
                    analysisOrigin: SOURCE_ORIGIN
                });
            } else if (target) {
                childBranches.push({
                    instance: child,
                    definition: target,
                    ancestors: new Set([...branch.ancestors, target.id]),
                    depth: branch.depth + 1
                });
            }
        }
        bindConstructorArguments(bindable, siblings, bindings, diagnostics);
        queue.push(...childBranches);
    }
    return { instances, bindings, roots, diagnostics };
}

function rootInstance(definition, path, reason) {
    return {
        id: instanceOccurrenceId(definition.id, path),
        kind: 'instance-occurrence',
        name: definition.name,
        path,
        parentInstanceId: null,
        targetDefinitionId: definition.id,
        targetResolutionStatus: 'exact',
        packageName: definition.packageName,
        declaredType: definition.returnInterface,
        constructor: null,
        constructorExpression: null,
        staticArguments: [],
        arguments: [],
        multiplicity: {
            status: 'exact',
            count: 1,
            expression: '1'
        },
        root: true,
        rootReason: reason,
        rootStatus: 'unbound',
        synthetic: true,
        expansionStatus: 'expanded',
        parameterBindings: [],
        location: definition.location || null,
        sourceRange: definition.sourceRange || null,
        analysisOrigin: ROOT_ORIGIN,
        evidence: {
            selectionReason: reason,
            path,
            targetDefinitionId: definition.id
        }
    };
}

function childInstance(parent, declaration, target, path, cycle) {
    return {
        ...declaration,
        id: instanceOccurrenceId(parent.id, path),
        kind: 'instance-occurrence',
        path,
        parentInstanceId: parent.id,
        targetDefinitionId: target?.id || null,
        targetResolutionStatus: target ? 'exact' : 'unresolved',
        root: false,
        synthetic: false,
        expansionStatus: cycle ? 'cycle-cut' : (target ? 'expanded' : 'unresolved'),
        parameterBindings: [],
        analysisOrigin: SOURCE_ORIGIN
    };
}

function resolveTarget(owner, name, byName, importsByPackage, diagnostics, location) {
    if (!name) return null;
    const matches = byName.get(name) || [];
    const local = matches.filter((item) => item.packageName === owner.packageName);
    if (local.length === 1) return local[0];
    const imports = importsByPackage.get(owner.packageName) || new Set();
    const imported = matches.filter((item) => imports.has(item.packageName));
    if (imported.length === 1) return imported[0];
    if (matches.length === 1) return matches[0];
    if (location && matches.length > 1) diagnostics.push({
        code: 'module-constructor.ambiguous', severity: 'warning', location,
        message: `Constructor ${name} resolves to multiple module definitions.`, analysisOrigin: SOURCE_ORIGIN
    });
    if (location && matches.length === 0) diagnostics.push({
        code: 'module-constructor.unresolved', severity: 'info', location,
        message: `Constructor ${name} has no source module definition.`, analysisOrigin: SOURCE_ORIGIN
    });
    return null;
}

function targetConstructor(declaration) {
    if (!declaration) return null;
    if (!['replicateM', 'mapM'].includes(declaration.constructor)) return declaration.constructor;
    return /^\s*(mk[A-Za-z_$][\w$]*)\b/.exec(declaration.arguments?.[0] || '')?.[1] || null;
}

function configuredRoots(modules, entries, diagnostics) {
    const result = [];
    for (const entry of entries) {
        const qualified = /^(.*?)(?:::|\.)(mk[A-Za-z_$][\w$]*)$/.exec(entry);
        const matches = modules.filter((item) => qualified
            ? item.packageName === qualified[1] && item.name === qualified[2]
            : item.name === entry);
        if (matches.length === 1 && !result.includes(matches[0])) result.push(matches[0]);
        else if (matches.length > 1) diagnostics.push({
            code: 'entrypoint.ambiguous',
            severity: 'warning',
            message: `Entrypoint ${entry} matches multiple module definitions.`,
            location: matches[0]?.location || null,
            analysisOrigin: SOURCE_ORIGIN
        });
        else if (matches.length === 0) diagnostics.push({
            code: 'entrypoint.unresolved',
            severity: 'info',
            message: `Entrypoint ${entry} has no source module definition.`,
            location: null,
            analysisOrigin: SOURCE_ORIGIN
        });
    }
    return result;
}

function uniqueRootPaths(modules) {
    const names = modules.map((item) => item.name);
    const qualified = modules.map((item) => names.indexOf(item.name) === names.lastIndexOf(item.name)
        ? item.name : `${item.packageName}.${item.name}`);
    const seen = new Map();
    return qualified.map((name) => {
        const count = (seen.get(name) || 0) + 1;
        seen.set(name, count);
        return count === 1 ? name : `${name}~${count}`;
    });
}

function uniqueChildNames(declarations) {
    const seen = new Map();
    return declarations.map((item) => {
        const count = (seen.get(item.name) || 0) + 1;
        seen.set(item.name, count);
        return count === 1 ? item.name : `${item.name}~${count}`;
    });
}

function expansionLimits(raw) {
    const positive = (value, fallback) => Number.isInteger(value) && value > 0 ? value : fallback;
    return {
        budget: positive(raw.maxInstances, positive(raw.maxNodes, 10000)),
        depth: positive(raw.maxInstanceDepth, 64),
        breadth: positive(raw.maxInstanceBreadth, 1000)
    };
}

function limitDiagnostic(code, location, message) {
    return { code, severity: 'warning', message, location: location || null, analysisOrigin: SOURCE_ORIGIN };
}

function groupBy(items, key) {
    const result = new Map();
    for (const item of items) result.set(key(item), [...(result.get(key(item)) || []), item]);
    return result;
}

module.exports = { buildInstances };
