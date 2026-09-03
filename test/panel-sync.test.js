'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ArchitecturePanel } = require('../src/panel/architecture-panel');

function makePanel(enabled = true) {
    const messages = [];
    const instance = Object.create(ArchitecturePanel.prototype);
    instance.model = {
        nodes: [
            {
                id: 'module',
                kind: 'module',
                sourceRange: {
                    uri: 'file:///Top.bsv',
                    line: 0,
                    column: 0,
                    endLine: 20,
                    endColumn: 9
                }
            },
            {
                id: 'rule',
                kind: 'rule',
                sourceRange: {
                    uri: 'file:///Top.bsv',
                    line: 5,
                    column: 4,
                    endLine: 9,
                    endColumn: 11
                }
            }
        ]
    };
    instance.panel = {
        webview: {
            postMessage(message) {
                messages.push(message);
                return Promise.resolve(true);
            }
        }
    };
    instance.vscode = {
        workspace: {
            getConfiguration() {
                return { get(_key, fallback) { return enabled ?? fallback; } };
            }
        }
    };
    instance.lastRevealedNodeId = null;
    return { instance, messages };
}

function selection(line, character) {
    return {
        textEditor: {
            document: {
                uri: {
                    path: '/Top.bsv',
                    toString() { return 'file:///Top.bsv'; }
                }
            }
        },
        selections: [{ active: { line, character } }]
    };
}

test('editor selection reveals smallest matching architecture node', () => {
    const { instance, messages } = makePanel(true);
    instance.revealEditorSelection(selection(6, 8));

    assert.deepEqual(messages, [{ type: 'revealNode', nodeId: 'rule' }]);
    instance.revealEditorSelection(selection(6, 8));
    assert.equal(messages.length, 1);
});

test('editor synchronization respects setting and BSV files', () => {
    const disabled = makePanel(false);
    disabled.instance.revealEditorSelection(selection(6, 8));
    assert.equal(disabled.messages.length, 0);

    const other = makePanel(true);
    const event = selection(6, 8);
    event.textEditor.document.uri.path = '/Top.txt';
    other.instance.revealEditorSelection(event);
    assert.equal(other.messages.length, 0);
});
