'use strict';

function createLineStarts(text) {
    const starts = [0];
    for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) === 10) starts.push(index + 1);
    }
    return starts;
}

function offsetToPosition(lineStarts, offset) {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        if (lineStarts[middle] <= offset) low = middle + 1;
        else high = middle - 1;
    }
    const line = Math.max(0, high);
    return { line, column: Math.max(0, offset - lineStarts[line]) };
}

function maskCommentsAndStrings(text) {
    const chars = [...text];
    let state = 'normal';
    let escaped = false;

    for (let index = 0; index < chars.length; index += 1) {
        const current = chars[index];
        const next = chars[index + 1];

        if (state === 'line-comment') {
            if (current === '\n') state = 'normal';
            else chars[index] = ' ';
            continue;
        }

        if (state === 'block-comment') {
            if (current === '*' && next === '/') {
                chars[index] = ' ';
                chars[index + 1] = ' ';
                index += 1;
                state = 'normal';
            } else if (current !== '\n') {
                chars[index] = ' ';
            }
            continue;
        }

        if (state === 'string') {
            if (current !== '\n') chars[index] = ' ';
            if (!escaped && current === '"') state = 'normal';
            escaped = !escaped && current === '\\';
            if (current !== '\\') escaped = false;
            continue;
        }

        if (current === '/' && next === '/') {
            chars[index] = ' ';
            chars[index + 1] = ' ';
            index += 1;
            state = 'line-comment';
            continue;
        }

        if (current === '/' && next === '*') {
            chars[index] = ' ';
            chars[index + 1] = ' ';
            index += 1;
            state = 'block-comment';
            continue;
        }

        if (current === '"') {
            chars[index] = ' ';
            state = 'string';
            escaped = false;
        }
    }

    return chars.join('');
}

function isIdentifierStart(character) {
    return /[A-Za-z_$]/.test(character || '');
}

function isIdentifierPart(character) {
    return /[A-Za-z0-9_$]/.test(character || '');
}

function readIdentifier(text, start) {
    let index = start;
    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (!isIdentifierStart(text[index])) return null;
    const begin = index;
    index += 1;
    while (index < text.length && isIdentifierPart(text[index])) index += 1;
    return { value: text.slice(begin, index), start: begin, end: index };
}

function identifierBefore(text, offset) {
    let index = offset - 1;
    while (index >= 0 && /\s/.test(text[index])) index -= 1;
    const end = index + 1;
    while (index >= 0 && isIdentifierPart(text[index])) index -= 1;
    if (end <= index + 1) return null;
    return { value: text.slice(index + 1, end), start: index + 1, end };
}

function findMatchingDelimiter(text, openIndex, openCharacter, closeCharacter) {
    let depth = 0;
    for (let index = openIndex; index < text.length; index += 1) {
        if (text[index] === openCharacter) depth += 1;
        else if (text[index] === closeCharacter) {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return -1;
}

function findStatementEnd(text, start) {
    let parentheses = 0;
    let brackets = 0;
    let braces = 0;
    for (let index = start; index < text.length; index += 1) {
        const character = text[index];
        if (character === '(') parentheses += 1;
        else if (character === ')') parentheses = Math.max(0, parentheses - 1);
        else if (character === '[') brackets += 1;
        else if (character === ']') brackets = Math.max(0, brackets - 1);
        else if (character === '{') braces += 1;
        else if (character === '}') braces = Math.max(0, braces - 1);
        else if (character === ';' && parentheses === 0 && brackets === 0 && braces === 0) return index;
    }
    return -1;
}

function splitTopLevel(text, delimiter = ',') {
    const parts = [];
    let start = 0;
    let parentheses = 0;
    let brackets = 0;
    let braces = 0;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === '(') parentheses += 1;
        else if (character === ')') parentheses = Math.max(0, parentheses - 1);
        else if (character === '[') brackets += 1;
        else if (character === ']') brackets = Math.max(0, brackets - 1);
        else if (character === '{') braces += 1;
        else if (character === '}') braces = Math.max(0, braces - 1);
        else if (
            character === delimiter
            && parentheses === 0
            && brackets === 0
            && braces === 0
        ) {
            parts.push(text.slice(start, index));
            start = index + 1;
        }
    }

    parts.push(text.slice(start));
    return parts;
}

function splitStatements(text, baseOffset = 0) {
    const statements = [];
    let start = 0;
    let parentheses = 0;
    let brackets = 0;
    let braces = 0;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === '(') parentheses += 1;
        else if (character === ')') parentheses = Math.max(0, parentheses - 1);
        else if (character === '[') brackets += 1;
        else if (character === ']') brackets = Math.max(0, brackets - 1);
        else if (character === '{') braces += 1;
        else if (character === '}') braces = Math.max(0, braces - 1);
        else if (character === ';' && parentheses === 0 && brackets === 0 && braces === 0) {
            statements.push({
                text: text.slice(start, index + 1),
                start: baseOffset + start,
                end: baseOffset + index + 1
            });
            start = index + 1;
        }
    }

    return statements;
}

function findKeywordEnd(text, start, keyword) {
    const expression = new RegExp(`\\b${keyword}\\b`, 'g');
    expression.lastIndex = start;
    const match = expression.exec(text);
    return match ? match.index : -1;
}

function isInsideSpan(offset, spans) {
    return spans.some((span) => offset >= span.start && offset <= span.end);
}

function findContainingSpan(offset, spans) {
    let result = null;
    for (const span of spans) {
        if (offset >= span.start && offset <= span.end) {
            if (!result || span.end - span.start < result.end - result.start) result = span;
        }
    }
    return result;
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncate(value, length = 160) {
    const normalized = normalizeWhitespace(value);
    return normalized.length <= length ? normalized : `${normalized.slice(0, Math.max(0, length - 1))}…`;
}

function getLeadingAnnotations(text, lineStarts, offset) {
    const position = offsetToPosition(lineStarts, offset);
    const lines = text.split(/\r?\n/);
    const annotations = {};
    let checked = 0;

    for (let line = position.line - 1; line >= 0 && checked < 8; line -= 1) {
        const content = lines[line].trim();
        if (content === '') {
            checked += 1;
            continue;
        }
        if (!content.startsWith('//')) break;
        checked += 1;
        const match = /^\/\/\s*@arch(?:\.|\s+)([A-Za-z][\w-]*)(?:\s+|=)?(.*)$/.exec(content);
        if (!match) continue;
        const key = match[1].toLowerCase();
        const value = match[2].trim();
        if (key === 'hide' || key === 'entry') annotations[key] = value === '' ? true : value !== 'false';
        else annotations[key] = value.replace(/^['"]|['"]$/g, '');
    }

    return annotations;
}

function getLeadingBsvAttributes(text, offset) {
    const attributes = scanBsvAttributes(text);
    const leading = [];
    let cursor = offset;
    for (let index = attributes.length - 1; index >= 0; index -= 1) {
        const attribute = attributes[index];
        if (attribute.end > cursor) continue;
        if (text.slice(attribute.end, cursor).trim()) break;
        leading.unshift(...attribute.assignments);
        cursor = attribute.start;
    }
    return leading;
}

function scanBsvAttributes(text) {
    const result = [];
    let index = 0;
    let state = 'normal';
    let escaped = false;
    while (index < text.length) {
        const current = text[index];
        const next = text[index + 1];
        if (state === 'line-comment') {
            if (current === '\n') state = 'normal';
            index += 1;
            continue;
        }
        if (state === 'block-comment') {
            if (current === '*' && next === '/') {
                state = 'normal';
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }
        if (state === 'string') {
            if (!escaped && current === '"') state = 'normal';
            escaped = current === '\\' && !escaped;
            if (current !== '\\') escaped = false;
            index += 1;
            continue;
        }
        if (current === '/' && next === '/') {
            state = 'line-comment';
            index += 2;
            continue;
        }
        if (current === '/' && next === '*') {
            state = 'block-comment';
            index += 2;
            continue;
        }
        if (current === '"') {
            state = 'string';
            escaped = false;
            index += 1;
            continue;
        }
        if (current === '(' && next === '*') {
            const end = findAttributeEnd(text, index + 2);
            if (end < 0) break;
            const raw = text.slice(index + 2, end);
            result.push({
                start: index,
                end: end + 2,
                raw,
                assignments: parseBsvAttributeAssignments(raw, index, end + 2)
            });
            index = end + 2;
            continue;
        }
        index += 1;
    }
    return result;
}

function findAttributeEnd(text, start) {
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length - 1; index += 1) {
        const current = text[index];
        if (quoted) {
            if (!escaped && current === '"') quoted = false;
            escaped = current === '\\' && !escaped;
            if (current !== '\\') escaped = false;
            continue;
        }
        if (current === '"') {
            quoted = true;
            escaped = false;
        } else if (current === '*' && text[index + 1] === ')') {
            return index;
        }
    }
    return -1;
}

function parseBsvAttributeAssignments(raw, start, end) {
    return splitOutsideQuotes(raw, ',').map((part) => {
        const match = /^\s*([A-Za-z_$][\w$]*)\s*(?:=\s*(.*))?$/.exec(part);
        if (!match) return null;
        const rawValue = normalizeWhitespace(match[2] || '');
        const value = rawValue.replace(/^"([\s\S]*)"$/, '$1').replace(/\\"/g, '"');
        return {
            name: match[1],
            rawValue,
            value,
            names: value ? splitOutsideQuotes(value, ',').map(normalizeWhitespace).filter(Boolean) : [],
            range: { start, end }
        };
    }).filter(Boolean);
}

function splitOutsideQuotes(text, delimiter) {
    const parts = [];
    let start = 0;
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const current = text[index];
        if (quoted) {
            if (!escaped && current === '"') quoted = false;
            escaped = current === '\\' && !escaped;
            if (current !== '\\') escaped = false;
            continue;
        }
        if (current === '"') quoted = true;
        else if (current === delimiter) {
            parts.push(text.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

function simpleGlobToRegExp(glob) {
    let expression = '^';
    for (let index = 0; index < glob.length; index += 1) {
        const character = glob[index];
        const next = glob[index + 1];
        if (character === '*' && next === '*') {
            expression += '.*';
            index += 1;
        } else if (character === '*') {
            expression += '[^/]*';
        } else if (character === '?') {
            expression += '[^/]';
        } else if ('\\.^$+{}()|[]'.includes(character)) {
            expression += `\\${character}`;
        } else {
            expression += character;
        }
    }
    expression += '$';
    return new RegExp(expression, 'i');
}

module.exports = {
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
    simpleGlobToRegExp,
    splitStatements,
    scanBsvAttributes,
    splitTopLevel,
    truncate
};
