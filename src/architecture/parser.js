'use strict';

const {
    createLineStarts,
    findContainingSpan,
    findKeywordEnd,
    findMatchingDelimiter,
    findStatementEnd,
    getLeadingBsvAttributes,
    getLeadingAnnotations,
    identifierBefore,
    isInsideSpan,
    maskCommentsAndStrings,
    normalizeWhitespace,
    offsetToPosition,
    readIdentifier,
    scanBsvAttributes,
    splitTopLevel,
    truncate
} = require('./source-utils');
const { analyzeBehavior } = require('./behavior-analysis');

const CONTROL_WORDS = new Set([
    'action', 'actionvalue', 'begin', 'case', 'default', 'else', 'end', 'endaction',
    'endcase', 'endinterface', 'endmethod', 'endrule', 'for', 'function', 'if',
    'interface', 'let', 'method', 'module', 'provisos', 'return', 'rule', 'rules',
    'typedef', 'while'
]);

const CALL_KEYWORDS = new Set([
    'action', 'begin', 'case', 'end', 'for', 'function', 'if', 'interface', 'matches',
    'method', 'module', 'provisos', 'return', 'rule', 'tagged', 'typeclass', 'while'
]);

const COMMON_BUILTINS = new Set([
    'actionOf', 'asReg', 'dynamicAssert', 'error', 'fromInteger', 'fromMaybe',
    'isValid', 'pack', 'staticAssert', 'tagged', 'truncate', 'unpack', 'valueOf',
    'zeroExtend'
]);

function makeLocation(uri, lineStarts, offset, endOffset = offset) {
    const start = offsetToPosition(lineStarts, Math.max(0, offset));
    const end = offsetToPosition(lineStarts, Math.max(offset, endOffset));
    return {
        uri,
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column
    };
}

function makeDiagnostic(uri, lineStarts, offset, severity, message) {
    return {
        severity,
        message,
        location: makeLocation(uri, lineStarts, offset)
    };
}

function parseBsvFile(text, options = {}) {
    const uri = options.uri || options.relativePath || 'untitled.bsv';
    const relativePath = options.relativePath || uri;
    const masked = maskCommentsAndStrings(text);
    const lineStarts = createLineStarts(text);
    const diagnostics = [];

    const packageMatch = /\bpackage\s+([A-Za-z_$][\w$]*)\s*;/.exec(masked);
    const packageName = packageMatch ? packageMatch[1] : fileStem(relativePath);
    const packageOffset = packageMatch ? packageMatch.index : 0;

    if (!packageMatch) {
        diagnostics.push(makeDiagnostic(
            uri,
            lineStarts,
            0,
            'warning',
            'No package declaration was found; the file name is used as the package name.'
        ));
    }

    const modules = parseModules(text, masked, uri, lineStarts, diagnostics);
    const moduleSpans = modules.map((module) => ({
        start: module.range.start,
        end: module.range.end,
        item: module
    }));
    const interfaces = parseInterfaces(text, masked, uri, lineStarts, moduleSpans, diagnostics);
    const functions = parseFunctions(text, masked, uri, lineStarts, moduleSpans, diagnostics);
    const types = parseTypedefs(text, masked, uri, lineStarts, moduleSpans, diagnostics);

    for (const module of modules) {
        populateModuleMembers(module, text, masked, uri, lineStarts, functions);
    }

    const imports = [];
    const importExpression = /\bimport\s+([A-Za-z_$][\w$]*)\s*::\s*(?:\*|[A-Za-z_$][\w$]*)\s*;/g;
    let importMatch;
    while ((importMatch = importExpression.exec(masked)) !== null) {
        imports.push({
            package: importMatch[1],
            location: makeLocation(uri, lineStarts, importMatch.index, importExpression.lastIndex)
        });
    }

    const exports = [];
    const exportExpression = /\bexport\s+([^;]+);/g;
    let exportMatch;
    while ((exportMatch = exportExpression.exec(masked)) !== null) {
        exports.push({
            value: normalizeWhitespace(exportMatch[1]),
            location: makeLocation(uri, lineStarts, exportMatch.index, exportExpression.lastIndex)
        });
    }

    return {
        uri,
        relativePath: normalizePath(relativePath),
        packageName,
        packageLocation: makeLocation(uri, lineStarts, packageOffset),
        packageAnnotations: getLeadingAnnotations(text, lineStarts, packageOffset),
        bsvAttributes: modules.length === 0
            ? decorateBsvAttributes(
                scanBsvAttributes(text).flatMap((attribute) => attribute.assignments),
                uri,
                lineStarts,
                0,
                { ownerKind: 'file', ownerName: packageName }
            )
            : [],
        imports,
        exports,
        modules,
        interfaces,
        functions,
        types,
        diagnostics,
        lineCount: lineStarts.length
    };
}

function parseModules(text, masked, uri, lineStarts, diagnostics) {
    const modules = [];
    const expression = /\bmodule\b/g;
    let match;

    while ((match = expression.exec(masked)) !== null) {
        let cursor = match.index + match[0].length;
        while (/\s/.test(masked[cursor] || '')) cursor += 1;
        if (masked[cursor] === '[') {
            const closing = findMatchingDelimiter(masked, cursor, '[', ']');
            if (closing >= 0) cursor = closing + 1;
        }

        const nameToken = readIdentifier(masked, cursor);
        if (!nameToken) continue;
        const headerEnd = findStatementEnd(masked, nameToken.end);
        if (headerEnd < 0) {
            diagnostics.push(makeDiagnostic(uri, lineStarts, match.index, 'error', `Module ${nameToken.value} has no terminating semicolon.`));
            continue;
        }

        const endKeyword = findKeywordEnd(masked, headerEnd + 1, 'endmodule');
        const end = endKeyword >= 0 ? endKeyword + 'endmodule'.length : masked.length;
        if (endKeyword < 0) {
            diagnostics.push(makeDiagnostic(uri, lineStarts, match.index, 'error', `Module ${nameToken.value} has no endmodule.`));
        }

        const header = masked.slice(match.index, headerEnd + 1);
        const returnInterface = extractModuleReturnInterface(masked, nameToken.end, headerEnd);
        const annotations = getLeadingAnnotations(text, lineStarts, match.index);
        const bsvAttributes = decorateBsvAttributes(
            getLeadingBsvAttributes(text, match.index),
            uri,
            lineStarts,
            0,
            { ownerKind: 'module', ownerName: nameToken.value }
        );
        modules.push({
            name: nameToken.value,
            returnInterface,
            signature: truncate(text.slice(match.index, headerEnd + 1), 260),
            annotations,
            bsvAttributes,
            location: makeLocation(uri, lineStarts, nameToken.start, nameToken.end),
            sourceRange: makeLocation(uri, lineStarts, match.index, end),
            range: { start: match.index, end, bodyStart: headerEnd + 1, bodyEnd: endKeyword >= 0 ? endKeyword : end },
            instances: [],
            rules: [],
            methods: [],
            localFunctions: [],
            providedInterfaces: [],
            summary: summarizeAnnotations(annotations)
        });

        expression.lastIndex = Math.max(expression.lastIndex, end);
    }

    return modules;
}

function extractModuleReturnInterface(masked, start, end) {
    let cursor = start;
    while (cursor < end) {
        while (/\s/.test(masked[cursor] || '')) cursor += 1;
        if (masked[cursor] === '#') {
            cursor += 1;
            while (/\s/.test(masked[cursor] || '')) cursor += 1;
            if (masked[cursor] === '(') {
                const closing = findMatchingDelimiter(masked, cursor, '(', ')');
                if (closing < 0) return null;
                cursor = closing + 1;
                continue;
            }
        }
        if (masked[cursor] === '(') {
            const closing = findMatchingDelimiter(masked, cursor, '(', ')');
            if (closing < 0 || closing > end) return null;
            const content = masked.slice(cursor + 1, closing);
            const match = /^\s*([A-Za-z_$][\w$]*)/.exec(content);
            return match ? match[1] : null;
        }
        cursor += 1;
    }
    return null;
}

function parseInterfaces(text, masked, uri, lineStarts, moduleSpans, diagnostics) {
    const interfaces = [];
    const expression = /\binterface\b/g;
    let match;

    while ((match = expression.exec(masked)) !== null) {
        if (isInsideSpan(match.index, moduleSpans)) continue;
        const nameToken = readIdentifier(masked, match.index + match[0].length);
        if (!nameToken) continue;
        const headerEnd = findStatementEnd(masked, nameToken.end);
        if (headerEnd < 0) continue;
        const endKeyword = findKeywordEnd(masked, headerEnd + 1, 'endinterface');
        if (endKeyword < 0) {
            diagnostics.push(makeDiagnostic(uri, lineStarts, match.index, 'error', `Interface ${nameToken.value} has no endinterface.`));
            continue;
        }

        const bodyStart = headerEnd + 1;
        const body = masked.slice(bodyStart, endKeyword);
        interfaces.push({
            name: nameToken.value,
            annotations: getLeadingAnnotations(text, lineStarts, match.index),
            signature: truncate(text.slice(match.index, headerEnd + 1), 260),
            methods: parseInterfaceMethodDeclarations(body, bodyStart, uri, lineStarts, nameToken.value),
            subinterfaces: parseSubinterfaceDeclarations(body, bodyStart, uri, lineStarts),
            location: makeLocation(uri, lineStarts, nameToken.start, nameToken.end),
            sourceRange: makeLocation(uri, lineStarts, match.index, endKeyword + 'endinterface'.length),
            range: { start: match.index, end: endKeyword + 'endinterface'.length, bodyStart, bodyEnd: endKeyword }
        });
        expression.lastIndex = endKeyword + 'endinterface'.length;
    }

    return interfaces;
}

function parseInterfaceMethodDeclarations(body, baseOffset, uri, lineStarts, interfaceName = null) {
    const methods = [];
    const expression = /\bmethod\b/g;
    let match;
    while ((match = expression.exec(body)) !== null) {
        const headerEnd = findStatementEnd(body, match.index + match[0].length);
        if (headerEnd < 0) continue;
        const header = body.slice(match.index + match[0].length, headerEnd);
        const callable = parseCallableSignature(header);
        if (!callable.name) continue;
        const absolute = baseOffset + match.index;
        const classification = classifyMethod(callable.returnType);
        methods.push({
            name: callable.name,
            returnType: callable.returnType,
            parameters: callable.parameters,
            guard: callable.guard,
            ...classification,
            port: createMethodPort(callable, classification, interfaceName),
            signature: truncate(body.slice(match.index, headerEnd + 1), 220),
            location: makeLocation(uri, lineStarts, absolute, baseOffset + headerEnd + 1)
        });
        expression.lastIndex = headerEnd + 1;
    }
    return methods;
}

function parseSubinterfaceDeclarations(body, baseOffset, uri, lineStarts) {
    const result = [];
    const expression = /\binterface\s+([A-Za-z_$][\w$]*(?:\s*#\s*\([^;]+?\))?)\s+([A-Za-z_$][\w$]*)\s*;/g;
    let match;
    while ((match = expression.exec(body)) !== null) {
        result.push({
            type: normalizeWhitespace(match[1]),
            name: match[2],
            location: makeLocation(uri, lineStarts, baseOffset + match.index, baseOffset + expression.lastIndex)
        });
    }
    return result;
}

function parseFunctions(text, masked, uri, lineStarts, moduleSpans, diagnostics) {
    const functions = [];
    const expression = /\bfunction\b/g;
    let match;

    while ((match = expression.exec(masked)) !== null) {
        const headerEnd = findStatementEnd(masked, match.index + match[0].length);
        if (headerEnd < 0) continue;
        const header = masked.slice(match.index + match[0].length, headerEnd);
        const callable = parseCallableSignature(header);
        if (!callable.name) continue;

        const inlineEquals = findTopLevelCharacter(header, '=');
        const endKeyword = inlineEquals >= 0 ? -1 : findKeywordEnd(masked, headerEnd + 1, 'endfunction');
        const end = endKeyword >= 0 ? endKeyword + 'endfunction'.length : headerEnd + 1;
        if (inlineEquals < 0 && endKeyword < 0) {
            diagnostics.push(makeDiagnostic(uri, lineStarts, match.index, 'warning', `Function ${callable.name} has no endfunction; only its signature was analyzed.`));
        }

        const bodyStart = inlineEquals >= 0
            ? match.index + match[0].length + inlineEquals + 1
            : headerEnd + 1;
        const bodyEnd = inlineEquals >= 0 ? headerEnd : (endKeyword >= 0 ? endKeyword : headerEnd);
        const bodyMasked = masked.slice(bodyStart, bodyEnd);
        const bodyText = text.slice(bodyStart, bodyEnd);
        const parentSpan = findContainingSpan(match.index, moduleSpans);
        const analysis = analyzeCallableBody(bodyText, bodyMasked, bodyStart, callable.parameters, uri, lineStarts);

        functions.push({
            name: callable.name,
            returnType: callable.returnType,
            parameters: callable.parameters,
            signature: truncate(text.slice(match.index, headerEnd + 1), 260),
            annotations: getLeadingAnnotations(text, lineStarts, match.index),
            parentModuleName: parentSpan ? parentSpan.item.name : null,
            locals: analysis.locals,
            calls: analysis.calls,
            returns: analysis.returns,
            operations: analysis.operations,
            location: makeLocation(uri, lineStarts, match.index + match[0].length + callable.nameOffset, match.index + match[0].length + callable.nameOffset + callable.name.length),
            sourceRange: makeLocation(uri, lineStarts, match.index, end),
            range: { start: match.index, end, bodyStart, bodyEnd }
        });

        expression.lastIndex = Math.max(expression.lastIndex, end);
    }

    return functions;
}

function parseCallableSignature(header) {
    const guardOffset = findTopLevelKeyword(header, 'if');
    const declaration = guardOffset >= 0 ? header.slice(0, guardOffset) : header;
    const guard = guardOffset >= 0
        ? stripOuterParentheses(normalizeWhitespace(header.slice(guardOffset + 2)))
        : '';
    const open = findCallableParameterOpen(declaration);
    if (open >= 0) {
        const nameToken = identifierBefore(declaration, open);
        if (!nameToken) return { name: null, nameOffset: 0, returnType: '', parameters: [] };
        const close = findMatchingDelimiter(declaration, open, '(', ')');
        const paramsText = close >= 0 ? declaration.slice(open + 1, close) : '';
        return {
            name: nameToken.value,
            nameOffset: nameToken.start,
            returnType: normalizeWhitespace(declaration.slice(0, nameToken.start)),
            parameters: parseParameters(paramsText),
            guard
        };
    }

    const boundary = findTopLevelCharacter(declaration, '=');
    const before = boundary >= 0 ? declaration.slice(0, boundary) : declaration;
    const nameToken = identifierBefore(before, before.length);
    return {
        name: nameToken ? nameToken.value : null,
        nameOffset: nameToken ? nameToken.start : 0,
        returnType: nameToken ? normalizeWhitespace(before.slice(0, nameToken.start)) : '',
        parameters: [],
        guard
    };
}

function classifyMethod(returnType) {
    const normalized = normalizeWhitespace(returnType);
    if (/^ActionValue\s*#/i.test(normalized)) {
        return {
            category: 'action-value',
            direction: 'request-response',
            resultType: typeApplicationArguments(normalized)[0] || null
        };
    }
    if (/^Action$/i.test(normalized)) {
        return { category: 'action', direction: 'input', resultType: null };
    }
    if (normalized) {
        return { category: 'value', direction: 'output', resultType: normalized };
    }
    return { category: 'unknown', direction: 'unknown', resultType: null };
}

function createMethodPort(callable, classification, interfaceName = null) {
    return {
        name: callable.name,
        interface: interfaceName,
        category: classification.category,
        direction: classification.direction,
        parameters: callable.parameters.map((parameter) => ({ ...parameter })),
        returnType: callable.returnType,
        resultType: classification.resultType,
        guarded: Boolean(callable.guard),
        guard: callable.guard || null
    };
}

function typeApplicationArguments(type) {
    const hash = type.indexOf('#');
    if (hash < 0) return [];
    const open = type.indexOf('(', hash);
    if (open < 0) return [];
    const close = findMatchingDelimiter(type, open, '(', ')');
    return close < 0 ? [] : splitTopLevel(type.slice(open + 1, close), ',').map(normalizeWhitespace);
}

function findTopLevelKeyword(text, keyword) {
    let parentheses = 0;
    let brackets = 0;
    let braces = 0;
    for (let index = 0; index <= text.length - keyword.length; index += 1) {
        const current = text[index];
        if (current === '(') parentheses += 1;
        else if (current === ')') parentheses = Math.max(0, parentheses - 1);
        else if (current === '[') brackets += 1;
        else if (current === ']') brackets = Math.max(0, brackets - 1);
        else if (current === '{') braces += 1;
        else if (current === '}') braces = Math.max(0, braces - 1);

        if (parentheses !== 0 || brackets !== 0 || braces !== 0) continue;
        if (text.slice(index, index + keyword.length) !== keyword) continue;
        const before = text[index - 1] || '';
        const after = text[index + keyword.length] || '';
        if (!/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after)) return index;
    }
    return -1;
}

function findCallableParameterOpen(header) {
    let depth = 0;
    for (let index = 0; index < header.length; index += 1) {
        const character = header[index];
        if (character === '(') {
            const previous = previousNonWhitespace(header, index - 1);
            if (depth === 0 && previous !== '#') return index;
            depth += 1;
        } else if (character === ')') {
            depth = Math.max(0, depth - 1);
        }
    }
    return -1;
}

function previousNonWhitespace(text, start) {
    let index = start;
    while (index >= 0 && /\s/.test(text[index])) index -= 1;
    return text[index] || '';
}

function parseParameters(text) {
    const parameters = [];
    for (const rawPart of splitTopLevel(text, ',')) {
        const part = normalizeWhitespace(rawPart);
        if (!part) continue;
        const token = identifierBefore(part, part.length);
        if (!token) continue;
        parameters.push({
            name: token.value,
            type: normalizeWhitespace(part.slice(0, token.start)) || 'inferred'
        });
    }
    return parameters;
}

function analyzeCallableBody(bodyText, bodyMasked, baseOffset, parameters, uri, lineStarts) {
    const locals = [];
    const declarationExpression = /\b(let|[A-Za-z_$][\w$]*(?:\s*#\s*\((?:[^;()]|\([^;()]*\))*\))?)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g;
    let declarationMatch;

    while ((declarationMatch = declarationExpression.exec(bodyMasked)) !== null) {
        const type = normalizeWhitespace(declarationMatch[1]);
        if (CONTROL_WORDS.has(type.toLowerCase())) continue;
        const expression = normalizeWhitespace(declarationMatch[3]);
        const absolute = baseOffset + declarationMatch.index;
        locals.push({
            name: declarationMatch[2],
            type: type === 'let' ? 'inferred' : type,
            expression: truncate(expression, 220),
            dependencies: [],
            location: makeLocation(uri, lineStarts, absolute, absolute + declarationMatch[0].length)
        });
    }

    const knownNames = new Set([
        ...parameters.map((parameter) => parameter.name),
        ...locals.map((local) => local.name)
    ]);
    for (const local of locals) {
        local.dependencies = identifiersIn(local.expression).filter((name) => knownNames.has(name) && name !== local.name);
    }

    const returns = [];
    const returnExpression = /\breturn\s+([^;]+);/g;
    let returnMatch;
    while ((returnMatch = returnExpression.exec(bodyMasked)) !== null) {
        const expression = normalizeWhitespace(returnMatch[1]);
        returns.push({
            expression: truncate(expression, 260),
            dependencies: identifiersIn(expression).filter((name) => knownNames.has(name)),
            location: makeLocation(uri, lineStarts, baseOffset + returnMatch.index, baseOffset + returnExpression.lastIndex)
        });
    }

    return {
        locals,
        returns,
        calls: extractCalls(bodyMasked),
        operations: extractOperations(bodyMasked)
    };
}

function extractCalls(text) {
    const calls = [];
    const seen = new Set();
    const expression = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    let match;
    while ((match = expression.exec(text)) !== null) {
        const name = match[1];
        if (CALL_KEYWORDS.has(name) || seen.has(name)) continue;
        seen.add(name);
        calls.push({ name, builtin: COMMON_BUILTINS.has(name) || /^[A-Z]/.test(name) });
    }
    return calls;
}

function extractOperations(text) {
    const operations = [];
    const candidates = [
        ['/', 'divide'],
        ['%', 'modulo'],
        ['*', 'multiply'],
        ['+', 'add'],
        ['-', 'subtract'],
        ['<<', 'left shift'],
        ['>>', 'right shift'],
        ['>=', 'compare ≥'],
        ['<=', 'compare ≤'],
        ['==', 'compare ='],
        ['&&', 'logical and'],
        ['||', 'logical or']
    ];
    for (const [symbol, label] of candidates) {
        if (text.includes(symbol)) operations.push({ symbol, label });
    }
    return operations;
}

function identifiersIn(text) {
    const result = [];
    const seen = new Set();
    const expression = /\b([A-Za-z_$][\w$]*)\b/g;
    let match;
    while ((match = expression.exec(text)) !== null) {
        if (!CONTROL_WORDS.has(match[1].toLowerCase()) && !seen.has(match[1])) {
            seen.add(match[1]);
            result.push(match[1]);
        }
    }
    return result;
}

function parseTypedefs(text, masked, uri, lineStarts, moduleSpans, diagnostics) {
    const types = [];
    const expression = /\btypedef\b/g;
    let match;

    while ((match = expression.exec(masked)) !== null) {
        const end = findStatementEnd(masked, match.index + match[0].length);
        if (end < 0) {
            diagnostics.push(makeDiagnostic(uri, lineStarts, match.index, 'warning', 'A typedef has no terminating semicolon.'));
            continue;
        }
        const statementMasked = masked.slice(match.index, end + 1);
        const statementText = text.slice(match.index, end + 1);
        const parsed = parseTypedefStatement(statementMasked, statementText);
        if (!parsed.name) {
            expression.lastIndex = end + 1;
            continue;
        }
        const parent = findContainingSpan(match.index, moduleSpans);
        types.push({
            ...parsed,
            parentModuleName: parent ? parent.item.name : null,
            annotations: getLeadingAnnotations(text, lineStarts, match.index),
            signature: truncate(statementText, 260),
            location: makeLocation(uri, lineStarts, match.index + parsed.nameOffset, match.index + parsed.nameOffset + parsed.name.length),
            sourceRange: makeLocation(uri, lineStarts, match.index, end + 1),
            range: { start: match.index, end: end + 1 }
        });
        expression.lastIndex = end + 1;
    }

    return types;
}

function parseTypedefStatement(masked, original) {
    const lower = masked.toLowerCase();
    let kind = 'alias';
    if (/^typedef\s+enum\b/.test(lower)) kind = 'enum';
    else if (/^typedef\s+struct\b/.test(lower)) kind = 'struct';
    else if (/^typedef\s+union\s+tagged\b/.test(lower)) kind = 'union';

    if (kind !== 'alias') {
        const closing = masked.lastIndexOf('}');
        if (closing < 0) return { name: null };
        const nameToken = readIdentifier(masked, closing + 1);
        if (!nameToken) return { name: null };
        const opening = masked.indexOf('{');
        const body = opening >= 0 ? original.slice(opening + 1, closing) : '';
        const details = kind === 'enum' ? parseEnumVariants(body) : parseStructFields(body);
        return {
            kind,
            name: nameToken.value,
            nameOffset: nameToken.start,
            details
        };
    }

    const beforeDeriving = masked.split(/\bderiving\b/)[0].replace(/;\s*$/, '');
    const nameToken = identifierBefore(beforeDeriving, beforeDeriving.length);
    if (!nameToken || nameToken.value === 'typedef') return { name: null };
    return {
        kind,
        name: nameToken.value,
        nameOffset: nameToken.start,
        details: {
            target: normalizeWhitespace(original.slice('typedef'.length, nameToken.start))
        }
    };
}

function parseEnumVariants(body) {
    const variantValues = splitTopLevel(body, ',')
        .map((part) => normalizeWhitespace(part))
        .map((part) => /^([A-Za-z_$][\w$]*)(?:\s*=\s*(.+))?$/.exec(part))
        .filter(Boolean)
        .map((match) => ({ name: match[1], value: match[2] || null }));
    return {
        variants: variantValues.map((variant) => variant.name),
        variantValues
    };
}

function parseStructFields(body) {
    const fields = [];
    for (const raw of body.split(';')) {
        const part = normalizeWhitespace(raw);
        if (!part) continue;
        const nameToken = identifierBefore(part, part.length);
        if (!nameToken) continue;
        fields.push({
            name: nameToken.value,
            type: normalizeWhitespace(part.slice(0, nameToken.start))
        });
    }
    return { fields };
}

function populateModuleMembers(module, text, masked, uri, lineStarts, allFunctions) {
    const bodyStart = module.range.bodyStart;
    const bodyEnd = module.range.bodyEnd;
    const bodyMasked = masked.slice(bodyStart, bodyEnd);
    const bodyText = text.slice(bodyStart, bodyEnd);

    module.instances = parseInstances(bodyMasked, bodyText, bodyStart, uri, lineStarts);
    module.rules = parseRules(bodyMasked, bodyText, bodyStart, uri, lineStarts, module.instances, module.name);
    module.methods = parseMethods(bodyMasked, bodyText, bodyStart, uri, lineStarts, module.instances, module.name);
    module.localFunctions = allFunctions.filter((fn) => fn.parentModuleName === module.name).map((fn) => fn.name);
    module.providedInterfaces = parseProvidedInterfaces(bodyMasked, bodyStart, uri, lineStarts);
}

function parseInstances(bodyMasked, bodyText, baseOffset, uri, lineStarts) {
    const instances = [];
    const expression = /<-\s*(mk[A-Za-z_$][\w$]*|replicateM|mapM)\b/g;
    let match;

    while ((match = expression.exec(bodyMasked)) !== null) {
        const declarationStart = findPreviousStatementBoundary(bodyMasked, match.index);
        const declaration = bodyMasked.slice(declarationStart, match.index);
        const nameToken = identifierBefore(declaration, declaration.length);
        if (!nameToken) continue;
        const declaredType = normalizeWhitespace(declaration.slice(0, nameToken.start).replace(/^(?:begin|end|action|actionvalue)\b\s*/i, ''));
        const inferred = declaredType === 'let';
        if (!declaredType || CONTROL_WORDS.has(nameToken.value.toLowerCase()) || !inferred && CONTROL_WORDS.has(declaredType.toLowerCase())) {
            continue;
        }

        const statementEnd = findStatementEnd(bodyMasked, match.index);
        const end = statementEnd >= 0 ? statementEnd + 1 : expression.lastIndex;
        const constructorStart = match.index + match[0].lastIndexOf(match[1]);
        const constructorExpression = normalizeWhitespace(bodyText.slice(constructorStart, statementEnd >= 0 ? statementEnd : end));
        const constructor = parseConstructorExpression(constructorExpression);
        const absoluteName = baseOffset + declarationStart + nameToken.start;
        instances.push({
            name: nameToken.value,
            type: inferred ? 'inferred' : declaredType,
            declaredType: inferred ? null : declaredType,
            constructor: constructor.name,
            constructorExpression,
            staticArguments: constructor.staticArguments,
            arguments: constructor.arguments,
            specialization: constructor.specialization,
            multiplicity: instanceMultiplicity(inferred ? '' : declaredType, constructor.name),
            primitiveKind: classifyPrimitive(inferred ? '' : declaredType, constructor.name),
            signature: truncate(bodyText.slice(declarationStart, end), 260),
            location: makeLocation(uri, lineStarts, absoluteName, absoluteName + nameToken.value.length),
            sourceRange: makeLocation(uri, lineStarts, baseOffset + declarationStart, baseOffset + end),
            range: { start: baseOffset + declarationStart, end: baseOffset + end }
        });
        expression.lastIndex = end;
    }

    return instances;
}

function parseConstructorExpression(expression) {
    const nameMatch = /^([A-Za-z_$][\w$]*)/.exec(expression);
    if (!nameMatch) return { name: expression, staticArguments: [], arguments: [], specialization: null };
    let cursor = nameMatch[0].length;
    while (/\s/.test(expression[cursor] || '')) cursor += 1;
    let specialization = null;
    let staticArguments = [];
    if (expression[cursor] === '#') {
        const open = expression.indexOf('(', cursor + 1);
        const close = open >= 0 ? findMatchingDelimiter(expression, open, '(', ')') : -1;
        if (close >= 0) {
            specialization = `#(${normalizeWhitespace(expression.slice(open + 1, close))})`;
            staticArguments = splitTopLevel(expression.slice(open + 1, close), ',').map(normalizeWhitespace);
            cursor = close + 1;
        }
    }
    while (/\s/.test(expression[cursor] || '')) cursor += 1;
    let args = [];
    if (expression[cursor] === '(') {
        const close = findMatchingDelimiter(expression, cursor, '(', ')');
        if (close >= 0) args = splitTopLevel(expression.slice(cursor + 1, close), ',').map(normalizeWhitespace);
    }
    return { name: nameMatch[1], staticArguments, arguments: args, specialization };
}

function instanceMultiplicity(type, constructor) {
    if (!['replicateM', 'mapM'].includes(constructor)) return null;
    const expression = /^Vector\s*#/i.test(type) ? typeApplicationArguments(type)[0] || null : null;
    if (!expression) return { status: 'unresolved', count: null, expression: null };
    if (/^\d+$/.test(expression)) {
        const count = Number(expression);
        if (Number.isSafeInteger(count)) return { status: 'exact', count, expression };
    }
    return { status: 'parameterized', count: null, expression };
}

function findPreviousStatementBoundary(text, offset) {
    const candidates = [
        text.lastIndexOf(';', offset - 1),
        text.lastIndexOf('endmodule', offset - 1),
        text.lastIndexOf('endrule', offset - 1),
        text.lastIndexOf('endmethod', offset - 1),
        text.lastIndexOf('endfunction', offset - 1)
    ];
    return Math.max(...candidates) + 1;
}

function classifyPrimitive(type, constructor) {
    if (/^Reg\s*#/i.test(type) || /^mk(?:C?Reg|DReg)/.test(constructor)) return 'register';
    if (/\bFIFOF?\s*#/i.test(type) || /^mk(?:Sized|Pipeline|Bypass)?FIFOF?/.test(constructor)) return 'fifo';
    if (/\b(?:BRAM|RegFile|RAM|ROM)\b/i.test(type) || /^mk(?:BRAM|RegFile|RAM|ROM)/.test(constructor)) return 'memory';
    if (/\b(?:Wire|RWire|PulseWire)\b/i.test(type) || /^mk(?:Bypass)?(?:R?Wire|PulseWire)/.test(constructor)) return 'wire';
    if (/\bVector\s*#/i.test(type) && /^replicateM$/.test(constructor)) return 'vector';
    return null;
}

function parseRules(bodyMasked, bodyText, baseOffset, uri, lineStarts, instances, moduleName) {
    const rules = [];
    const expression = /\brule\s+([A-Za-z_$][\w$]*)/g;
    let match;

    while ((match = expression.exec(bodyMasked)) !== null) {
        const headerEnd = findStatementEnd(bodyMasked, expression.lastIndex);
        if (headerEnd < 0) continue;
        const endKeyword = findKeywordEnd(bodyMasked, headerEnd + 1, 'endrule');
        const end = endKeyword >= 0 ? endKeyword + 'endrule'.length : headerEnd + 1;
        const guardText = bodyMasked.slice(expression.lastIndex, headerEnd).trim();
        const contentStart = headerEnd + 1;
        const contentEnd = endKeyword >= 0 ? endKeyword : headerEnd;
        const content = bodyMasked.slice(contentStart, contentEnd);
        const contentText = bodyText.slice(contentStart, contentEnd);
        const absoluteName = baseOffset + match.index + match[0].lastIndexOf(match[1]);
        const bsvAttributes = decorateBsvAttributes(
            getLeadingBsvAttributes(bodyText, match.index),
            uri,
            lineStarts,
            baseOffset,
            { ownerKind: 'rule', ownerName: match[1], moduleName }
        );
        const behavior = analyzeBehavior({
            text: contentText,
            masked: content,
            baseOffset: baseOffset + contentStart,
            instances,
            callable: match[1],
            makeLocation: (start, finish) => makeLocation(uri, lineStarts, start, finish)
        });
        const guardBehavior = analyzeBehavior({
            text: bodyText.slice(expression.lastIndex, headerEnd),
            masked: bodyMasked.slice(expression.lastIndex, headerEnd),
            baseOffset: baseOffset + expression.lastIndex,
            instances,
            callable: match[1],
            makeLocation: (start, finish) => makeLocation(uri, lineStarts, start, finish)
        });
        const combined = mergeBehavior(guardBehavior, behavior);
        rules.push({
            name: match[1],
            guard: truncate(stripOuterParentheses(guardText), 220),
            bsvAttributes,
            calls: extractCalls(content),
            references: unique([...extractInstanceReferences(content, instances), ...combined.accesses.map((item) => item.instance)]),
            ...combined,
            signature: truncate(bodyText.slice(match.index, headerEnd + 1), 240),
            location: makeLocation(uri, lineStarts, absoluteName, absoluteName + match[1].length),
            sourceRange: makeLocation(uri, lineStarts, baseOffset + match.index, baseOffset + end),
            range: { start: baseOffset + match.index, end: baseOffset + end }
        });
        expression.lastIndex = Math.max(expression.lastIndex, end);
    }

    return rules;
}

function parseMethods(bodyMasked, bodyText, baseOffset, uri, lineStarts, instances, moduleName) {
    const methods = [];
    const expression = /\bmethod\b/g;
    let match;

    while ((match = expression.exec(bodyMasked)) !== null) {
        const headerEnd = findStatementEnd(bodyMasked, match.index + match[0].length);
        if (headerEnd < 0) continue;
        const header = bodyMasked.slice(match.index + match[0].length, headerEnd);
        const rawHeader = bodyText.slice(match.index + match[0].length, headerEnd);
        const callable = parseCallableSignature(header);
        if (!callable.name) continue;
        const inline = findTopLevelCharacter(header, '=') >= 0;
        const endKeyword = inline ? -1 : findKeywordEnd(bodyMasked, headerEnd + 1, 'endmethod');
        const end = endKeyword >= 0 ? endKeyword + 'endmethod'.length : headerEnd + 1;
        const contentStart = inline
            ? match.index + match[0].length + findTopLevelCharacter(header, '=') + 1
            : headerEnd + 1;
        const contentEnd = inline ? headerEnd : (endKeyword >= 0 ? endKeyword : headerEnd);
        const content = bodyMasked.slice(contentStart, contentEnd);
        const contentText = bodyText.slice(contentStart, contentEnd);
        const absoluteName = baseOffset + match.index + match[0].length + callable.nameOffset;
        const bsvAttributes = decorateBsvAttributes(
            getLeadingBsvAttributes(bodyText, match.index),
            uri,
            lineStarts,
            baseOffset,
            { ownerKind: 'method', ownerName: callable.name, moduleName }
        );
        const behavior = analyzeBehavior({
            text: contentText,
            masked: content,
            baseOffset: baseOffset + contentStart,
            instances,
            callable: callable.name,
            makeLocation: (start, finish) => makeLocation(uri, lineStarts, start, finish)
        });
        const guardOffset = findTopLevelKeyword(header, 'if');
        const guardBehavior = guardOffset >= 0
            ? analyzeBehavior({
                text: rawHeader.slice(guardOffset + 2),
                masked: header.slice(guardOffset + 2),
                baseOffset: baseOffset + match.index + match[0].length + guardOffset + 2,
                instances,
                callable: callable.name,
                makeLocation: (start, finish) => makeLocation(uri, lineStarts, start, finish)
            })
            : emptyBehavior();
        const combined = mergeBehavior(guardBehavior, behavior);
        const classification = classifyMethod(callable.returnType);
        methods.push({
            name: callable.name,
            returnType: callable.returnType,
            parameters: callable.parameters,
            guard: callable.guard,
            ...classification,
            port: createMethodPort(callable, classification),
            bsvAttributes,
            inline,
            calls: extractCalls(content),
            references: unique([...extractInstanceReferences(content, instances), ...combined.accesses.map((item) => item.instance)]),
            ...combined,
            signature: truncate(bodyText.slice(match.index, headerEnd + 1), 240),
            location: makeLocation(uri, lineStarts, absoluteName, absoluteName + callable.name.length),
            sourceRange: makeLocation(uri, lineStarts, baseOffset + match.index, baseOffset + end),
            range: { start: baseOffset + match.index, end: baseOffset + end }
        });
        expression.lastIndex = Math.max(expression.lastIndex, end);
    }

    return methods;
}

function extractInstanceReferences(content, instances) {
    const references = [];
    for (const instance of instances) {
        const escaped = escapeRegExp(instance.name);
        const member = new RegExp(`\\b${escaped}\\s*\\.`, 'm');
        const assignment = new RegExp(`\\b${escaped}\\s*<=`, 'm');
        if (member.test(content) || assignment.test(content)) references.push(instance.name);
    }
    return references;
}

function emptyBehavior() {
    return { accesses: [], reads: [], writes: [], invocations: [] };
}

function mergeBehavior(...items) {
    const accesses = [];
    const seen = new Set();
    for (const item of items) {
        for (const access of item.accesses || []) {
            const key = [
                access.instance,
                access.memberPath || '',
                access.kind,
                access.operation,
                access.location?.line,
                access.location?.column
            ].join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            accesses.push(access);
        }
    }
    return {
        accesses,
        reads: unique(accesses.filter((item) => item.kind === 'read').map((item) => item.instance)),
        writes: unique(accesses.filter((item) => item.kind === 'write').map((item) => item.instance)),
        invocations: unique(accesses
            .filter((item) => ['invoke', 'return', 'access'].includes(item.kind))
            .map((item) => `${item.instance}.${item.member || ''}`.replace(/\.$/, '')))
    };
}

function unique(values) {
    return [...new Set(values)];
}

function decorateBsvAttributes(attributes, uri, lineStarts, baseOffset = 0, owner = {}) {
    return attributes.map((attribute) => ({
        ...attribute,
        ...owner,
        location: makeLocation(
            uri,
            lineStarts,
            baseOffset + attribute.range.start,
            baseOffset + attribute.range.end
        )
    }));
}

function parseProvidedInterfaces(bodyMasked, baseOffset, uri, lineStarts) {
    const result = [];
    const expression = /\binterface\s+(?:([A-Za-z_$][\w$]*(?:\s*#\s*\([^;]+?\))?)\s+)?([A-Za-z_$][\w$]*)\s*(?:=|;)/g;
    let match;
    while ((match = expression.exec(bodyMasked)) !== null) {
        result.push({
            type: normalizeWhitespace(match[1] || 'inferred'),
            name: match[2],
            location: makeLocation(uri, lineStarts, baseOffset + match.index, baseOffset + expression.lastIndex)
        });
    }
    return result;
}

function stripOuterParentheses(value) {
    const trimmed = value.trim();
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) return trimmed.slice(1, -1).trim();
    return trimmed;
}

function findTopLevelCharacter(text, character) {
    let parentheses = 0;
    let brackets = 0;
    let braces = 0;
    for (let index = 0; index < text.length; index += 1) {
        const current = text[index];
        if (current === '(') parentheses += 1;
        else if (current === ')') parentheses = Math.max(0, parentheses - 1);
        else if (current === '[') brackets += 1;
        else if (current === ']') brackets = Math.max(0, brackets - 1);
        else if (current === '{') braces += 1;
        else if (current === '}') braces = Math.max(0, braces - 1);
        else if (current === character && parentheses === 0 && brackets === 0 && braces === 0) return index;
    }
    return -1;
}

function summarizeAnnotations(annotations) {
    return annotations.description || annotations.label || '';
}

function fileStem(path) {
    const normalized = normalizePath(path);
    const name = normalized.split('/').pop() || 'AnonymousPackage';
    return name.replace(/\.bsv$/i, '') || 'AnonymousPackage';
}

function normalizePath(path) {
    return String(path || '').replace(/\\/g, '/');
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    analyzeCallableBody,
    classifyPrimitive,
    extractCalls,
    parseBsvFile,
    parseCallableSignature,
    parseParameters,
    classifyMethod
};
