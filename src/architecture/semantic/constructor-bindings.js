'use strict';

const { constructorBindingId } = require('./ids');

const SOURCE_ORIGIN = 'Source-derived';

function bindConstructorArguments(branches, siblings, bindings, diagnostics) {
    for (const { instance, definition } of branches) {
        if (['replicateM', 'mapM'].includes(instance.constructor)) {
            instance.staticBindings = [];
            continue;
        }
        instance.staticBindings = metadataBindings(
            definition.typeParameters || [],
            instance.staticArguments || []
        );
        const actuals = instance.arguments || [];
        const formals = definition.constructorParameters || [];
        if (actuals.length !== formals.length) {
            diagnostics.push({
                code: 'constructor.arity',
                severity: 'warning',
                message: `Constructor ${definition.name} expects ${formals.length} arguments but received ${actuals.length}.`,
                location: instance.location || definition.location || null,
                analysisOrigin: SOURCE_ORIGIN
            });
        }
        const count = Math.max(actuals.length, formals.length);
        for (let index = 0; index < count; index += 1) {
            const actualExpression = actuals[index] ?? null;
            const formal = formals[index];
            const source = typeof actualExpression === 'string'
                && /^[A-Za-z_$][\w$]*$/.test(actualExpression)
                ? siblings.get(actualExpression) : null;
            if (source && formal) {
                bindings.push({
                    id: constructorBindingId(instance.id, index),
                    kind: 'constructor-binding',
                    sourceInstanceId: source.id,
                    targetInstanceId: instance.id,
                    formalParameter: { index, name: formal.name, type: formal.type },
                    actualExpression,
                    resolutionStatus: 'exact',
                    location: instance.location || null,
                    analysisOrigin: SOURCE_ORIGIN
                });
            } else {
                instance.parameterBindings.push({
                    index,
                    formalParameter: formal?.name || null,
                    actualExpression,
                    resolutionStatus: formal && actualExpression !== null ? 'metadata' : 'unresolved'
                });
            }
        }
    }
}

function metadataBindings(formals, actuals) {
    const count = Math.max(formals.length, actuals.length);
    return Array.from({ length: count }, (_, index) => ({
        index,
        formalParameter: formals[index]?.name || null,
        actualExpression: actuals[index] ?? null,
        resolutionStatus: formals[index] && actuals[index] !== undefined ? 'metadata' : 'unresolved'
    }));
}

module.exports = { bindConstructorArguments };
