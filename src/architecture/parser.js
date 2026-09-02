'use strict';

const {
    createLineStarts,
    findContainingSpan,
    findKeywordEnd,
    findMatchingDelimiter,
    findStatementEnd,
    getLeadingAnnotations,
    identifierBefore,
    isInsideSpan,
    maskCommentsAndStrings,
    normalizeWhitespace,
    offsetToPosition,
    readIdentifier,
    splitTopLevel,
    truncate
} = require('./source-utils');

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
        modules.push({
            name: nameToken.value,
            returnInterface,
            signature: truncate(text.slice(match.index, headerEnd + 1), 260),
            annotations,
            location: makeLocation(uri, lineStarts, nameToken.start, nameToken.end),
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
            methods: parseInterfaceMethodDeclarations(body, bodyStart, uri, lineStarts),
            subinterfaces: parseSubinterfaceDeclarations(body, bodyStart, uri, lineStarts),
            location: makeLocation(uri, lineStarts, nameToken.start, nameToken.end),
            range: { start: match.index, end: endKeyword + 'endinterface'.length, bodyStart, bodyEnd: endKeyword }
        });
        expression.lastIndex = endKeyword + 'endinterface'.length;
    }

    return interfaces;
}

function parseInterfaceMethodDeclarations(body, baseOffset, uri, lineStarts) {
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
        methods.push({
            name: callable.name,
            returnType: callable.returnType,
            parameters: callable.parameters,
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
            range: { start: match.index, end, bodyStart, bodyEnd }
        });

        expression.lastIndex = Math.max(expression.lastIndex, end);
    }

    return functions;
}

function parseCallableSignature(header) {
    const guardOffset = findTopLevelKeyword(header, 'if');
    const declaration = guardOffset >= 0 ? header.slice(0, guardOffset) : header;
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
            parameters: parseParameters(paramsText)
        };
    }

    const boundary = findTopLevelCharacter(declaration, '=');
    const before = boundary >= 0 ? declaration.slice(0, boundary) : declaration;
    const nameToken = identifierBefore(before, before.length);
    return {
        name: nameToken ? nameToken.value : null,
        nameOffset: nameToken ? nameToken.start : 0,
        returnType: nameToken ? normalizeWhitespace(before.slice(0, nameToken.start)) : '',
        parameters: []
    };
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
    return {
        variants: splitTopLevel(body, ',')
            .map((part) => normalizeWhitespace(part))
            .map((part) => /^([A-Za-z_$][\w$]*)/.exec(part))
            .filter(Boolean)
            .map((match) => match[1])
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
    module.rules = parseRules(bodyMasked, bodyText, bodyStart, uri, lineStarts, module.instances);
    module.methods = parseMethods(bodyMasked, bodyText, bodyStart, uri, lineStarts, module.instances);
    module.localFunctions = allFunctions.filter((fn) => fn.parentModuleName === module.name).map((fn) => fn.name);
    module.providedInterfaces = parseProvidedInterfaces(bodyMasked, bodyStart, uri, lineStarts);
}

function parseInstances(bodyMasked, bodyText, baseOffset, uri, lineStarts) {
    const instances = [];
    const expression = /<-\s*(mk[A-Za-z_$][\w$]*)\b/g;
    let match;

    while ((match = expression.exec(bodyMasked)) !== null) {
        const declarationStart = findPreviousStatementBoundary(bodyMasked, match.index);
        const declaration = bodyMasked.slice(declarationStart, match.index);
        const nameToken = identifierBefore(declaration, declaration.length);
        if (!nameToken) continue;
        const typeText = normalizeWhitespace(declaration.slice(0, nameToken.start).replace(/^(?:begin|end|action|actionvalue)\b\s*/i, ''));
        if (!typeText || CONTROL_WORDS.has(nameToken.value.toLowerCase())) continue;

        const statementEnd = findStatementEnd(bodyMasked, match.index);
        const end = statementEnd >= 0 ? statementEnd + 1 : expression.lastIndex;
        const absoluteName = baseOffset + declarationStart + nameToken.start;
        instances.push({
            name: nameToken.value,
            type: typeText,
            constructor: match[1],
            primitiveKind: classifyPrimitive(typeText, match[1]),
            signature: truncate(bodyText.slice(declarationStart, end), 260),
            location: makeLocation(uri, lineStarts, absoluteName, absoluteName + nameToken.value.length),
            range: { start: baseOffset + declarationStart, end: baseOffset + end }
        });
        expression.lastIndex = end;
    }

    return instances;
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

function parseRules(bodyMasked, bodyText, baseOffset, uri, lineStarts, instances) {
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
        const absoluteName = baseOffset + match.index + match[0].lastIndexOf(match[1]);
        rules.push({
            name: match[1],
            guard: truncate(stripOuterParentheses(guardText), 220),
            calls: extractCalls(content),
            references: extractInstanceReferences(content, instances),
            signature: truncate(bodyText.slice(match.index, headerEnd + 1), 240),
            location: makeLocation(uri, lineStarts, absoluteName, absoluteName + match[1].length),
            range: { start: baseOffset + match.index, end: baseOffset + end }
        });
        expression.lastIndex = Math.max(expression.lastIndex, end);
    }

    return rules;
}

function parseMethods(bodyMasked, bodyText, baseOffset, uri, lineStarts, instances) {
    const methods = [];
    const expression = /\bmethod\b/g;
    let match;

    while ((match = expression.exec(bodyMasked)) !== null) {
        const headerEnd = findStatementEnd(bodyMasked, match.index + match[0].length);
        if (headerEnd < 0) continue;
        const header = bodyMasked.slice(match.index + match[0].length, headerEnd);
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
        const absoluteName = baseOffset + match.index + match[0].length + callable.nameOffset;
        methods.push({
            name: callable.name,
            returnType: callable.returnType,
            parameters: callable.parameters,
            inline,
            calls: extractCalls(content),
            references: extractInstanceReferences(content, instances),
            signature: truncate(bodyText.slice(match.index, headerEnd + 1), 240),
            location: makeLocation(uri, lineStarts, absoluteName, absoluteName + callable.name.length),
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
    parseParameters
};
