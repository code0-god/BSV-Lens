'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const SourceResolution = require('../media/source-resolution');

function candidate(id, role = 'occurrence', ownerId = null, parentId = null) {
    return { id, role, ownerId, parentId };
}

function match(presentations) {
    return {
        status: 'exact',
        references: [{ id: 'source', kind: 'implementation-method', presentations }]
    };
}

function context(overrides = {}) {
    return {
        focusInstanceId: null,
        selectedNodeId: null,
        visibleNodeIds: [],
        viewNodeIds: [],
        ...overrides
    };
}

function resolve(sourceReference, options = {}, model = { nodes: [] }) {
    return SourceResolution.resolve(model, sourceReference, context(options));
}

test('resolver reports all five synchronization statuses', () => {
    assert.equal(resolve(null).status, 'unresolved');
    assert.equal(resolve(match([candidate('one')]), {
        visibleNodeIds: ['one'], viewNodeIds: ['one']
    }).status, 'visible-exact');
    assert.equal(resolve(match([
        candidate('one'), candidate('two')
    ]), {
        visibleNodeIds: ['one', 'two'], viewNodeIds: ['one', 'two']
    }).status, 'visible-multiple');
    assert.equal(resolve(match([candidate('one')]), {
        focusInstanceId: 'other', viewNodeIds: ['one']
    }).status, 'outside-focus');
    assert.equal(resolve(match([candidate('one')])).status, 'outside-view');
});

test('focus hierarchy and selected or focused parent disambiguate without first match', () => {
    const candidates = [
        candidate('left-method', 'behavior', 'left', 'left'),
        candidate('right-method', 'behavior', 'right', 'right')
    ];
    const visible = ['left-method', 'right-method'];

    const hierarchyModel = { nodes: [
        { id: 'root', parentId: null },
        { id: 'left', parentId: 'root' },
        { id: 'right', parentId: 'root' },
        { id: 'left-method', parentId: 'left' },
        { id: 'right-method', parentId: 'right' }
    ] };
    const focused = resolve(match(candidates), {
        visibleNodeIds: visible,
        viewNodeIds: visible,
        focusInstanceId: 'right'
    }, hierarchyModel);
    assert.equal(focused.status, 'visible-exact');
    assert.equal(focused.presentationNodeId, 'right-method');

    const selectedParent = resolve(match(candidates), {
        visibleNodeIds: visible,
        viewNodeIds: visible,
        selectedNodeId: 'left'
    });
    assert.equal(selectedParent.status, 'visible-exact');
    assert.equal(selectedParent.presentationNodeId, 'left-method');

    const ambiguous = resolve(match(candidates), {
        visibleNodeIds: visible,
        viewNodeIds: visible
    });
    assert.equal(ambiguous.status, 'visible-multiple');
    assert.deepEqual(ambiguous.presentationNodeIds, visible);
});

test('architecture prefers occurrence and endpoint presentations over secondary definitions', () => {
    const presentations = [
        candidate('definition', 'definition'),
        candidate('behavior', 'behavior', 'owner', 'owner'),
        candidate('endpoint', 'endpoint', 'owner', 'owner')
    ];
    const result = resolve(match(presentations), {
        visibleNodeIds: presentations.map((item) => item.id),
        viewNodeIds: presentations.map((item) => item.id),
        focusInstanceId: 'owner'
    });

    assert.equal(result.status, 'visible-exact');
    assert.equal(result.presentationNodeId, 'endpoint');
});

test('one visible occurrence cannot hide canonical duplicate ambiguity without context', () => {
    const candidates = [
        candidate('visible', 'occurrence', 'left'),
        candidate('collapsed', 'occurrence', 'right')
    ];
    const result = resolve(match(candidates), {
        visibleNodeIds: ['visible'],
        viewNodeIds: ['visible']
    });

    assert.equal(result.status, 'visible-multiple');
    assert.deepEqual(result.presentationNodeIds, ['collapsed', 'visible']);
});

test('sibling occurrences under one parent remain distinct ambiguity candidates', () => {
    const siblings = [
        candidate('top.foo0', 'occurrence', 'top', 'top'),
        candidate('top.foo1', 'occurrence', 'top', 'top')
    ];
    const result = resolve(match(siblings), {
        visibleNodeIds: siblings.map((item) => item.id),
        viewNodeIds: siblings.map((item) => item.id)
    });

    assert.equal(result.status, 'visible-multiple');
    assert.deepEqual(result.presentationNodeIds, ['top.foo0', 'top.foo1']);
});

test('focus none never reports outside-focus', () => {
    const result = resolve(match([candidate('hidden')]), {
        visibleNodeIds: [],
        viewNodeIds: ['hidden']
    });
    assert.equal(result.status, 'outside-view');
});

test('globally unique presentation resolves but duplicate peers remain ambiguous', () => {
    const unique = resolve(match([candidate('only')]), {
        visibleNodeIds: ['only'], viewNodeIds: ['only']
    });
    assert.equal(unique.status, 'visible-exact');
    assert.equal(unique.presentationNodeId, 'only');

    const duplicate = resolve({
        status: 'multiple',
        references: [
            { id: 'first', presentations: [candidate('first')] },
            { id: 'second', presentations: [candidate('second')] }
        ]
    }, {
        visibleNodeIds: ['first', 'second'], viewNodeIds: ['first', 'second']
    });
    assert.equal(duplicate.status, 'visible-multiple');
});
