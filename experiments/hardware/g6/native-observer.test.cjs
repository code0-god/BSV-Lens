'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { editorColumn } = require('./observer/editor-column.cjs');
const document = { uri: { toString: () => 'file:///fixture/Connected.bsv' } };
const api = { ViewColumn: { One: 1, Beside: -2 }, window: { visibleTextEditors: [], activeTextEditor: undefined } };

test('reverse cursor reuses the visible source editor instead of replacing the panel', () => {
    const vscode = { ...api, window: { visibleTextEditors: [{ document, viewColumn: 2 }], activeTextEditor: undefined } };
    assert.equal(editorColumn(vscode, document, true), 2);
    assert.equal(editorColumn(vscode, document, false), 2);
});
test('active matching editor wins when the same document is visible twice', () => {
    const first = { document, viewColumn: 2 }, active = { document, viewColumn: 3 };
    assert.equal(editorColumn({ ...api, window: { visibleTextEditors: [first, active], activeTextEditor: active } }, document, true), 3);
});
test('reverse cursor falls back Beside; ordinary initial open retains One', () => {
    assert.equal(editorColumn(api, document, true), -2);
    assert.equal(editorColumn(api, document, false), 1);
});
