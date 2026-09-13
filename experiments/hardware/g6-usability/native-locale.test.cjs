'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { localeArguments, parseArguments, launchNative, validateLanguagePackManifest } = require('../g6/native-driver.cjs');

test('native locale is optional, bounded and leaves default arguments unchanged', () => {
    assert.deepEqual(localeArguments(), []);
    assert.deepEqual(localeArguments('en'), ['--locale=en']);
    assert.deepEqual(localeArguments('ko'), ['--locale=ko']);
    for (const value of [null, '', 'ko-KR', 'en --disable-workspace-trust', ['ko'], { locale: 'en' }])
        assert.throws(() => localeArguments(value), /must be en or ko/);
});

test('native CLI accepts a single supported locale without changing existing default parse results', () => {
    const args = ['--vsix', 'product.vsix', '--workspace', 'workspace', '--output', 'run/g6'];
    const expected = { vsix: 'product.vsix', workspace: 'workspace', output: 'run/g6' };
    assert.deepEqual(parseArguments(args), expected);
    assert.deepEqual(parseArguments([...args, '--locale', 'ko']), { ...expected, locale: 'ko' });
    for (const suffix of [['--locale'], ['--locale', 'unknown'], ['--locale', 'en', '--locale', 'ko']])
        assert.throws(() => parseArguments([...args, ...suffix]));
});

test('invalid API locale is rejected before input files or a profile are accessed', async () => {
    await assert.rejects(launchNative({ vsix: 'nonexistent.vsix', workspace: 'nonexistent-workspace',
        output: 'nonexistent-run/g6', locale: 'ko --disable-extensions' }), /must be en or ko/);
});

test('optional language pack accepts only fixed Microsoft Korean translations without executable entrypoints', () => {
    const manifest = { publisher: 'MS-CEINTL', name: 'vscode-language-pack-ko', version: '1.131.2026090407',
        contributes: { localizations: [{ languageId: 'ko', translations: [{ id: 'vscode', path: './translations/main.i18n.json' }] }] } };
    assert.equal(validateLanguagePackManifest(manifest), 'translations/main.i18n.json');
    for (const change of [copy => { copy.publisher = 'foreign'; }, copy => { copy.main = 'extension.js'; },
        copy => { copy.browser = 'extension.js'; }, copy => { copy.contributes.commands = []; },
        copy => { copy.contributes.localizations[0].languageId = 'en'; },
        copy => { copy.contributes.localizations[0].translations[0].path = './translations/../../escape.json'; }]) {
        const changed = structuredClone(manifest); change(changed); assert.throws(() => validateLanguagePackManifest(changed));
    }
});
