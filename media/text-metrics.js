'use strict';

((root, factory) => {
    const api = factory();
    root.BsvArchitectureText = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis, () => {
    const mark = /^\p{Mark}+$/u;
    const wide = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Extended_Pictographic}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u;
    const segmenter = typeof Intl?.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;

    function graphemes(value) {
        const text = String(value ?? '');
        return segmenter
            ? [...segmenter.segment(text)].map((entry) => entry.segment)
            : Array.from(text);
    }

    function graphemeWidth(value) {
        if (!value || mark.test(value)) return 0;
        return wide.test(value) ? 2 : 1;
    }

    function displayWidth(value) {
        return graphemes(value).reduce((sum, grapheme) => sum + graphemeWidth(grapheme), 0);
    }

    function truncateWidth(value, maximum) {
        const text = String(value ?? '').replace(/\s+/g, ' ').trim();
        if (displayWidth(text) <= maximum) return text;
        const limit = Math.max(0, maximum - 1);
        let result = '';
        let width = 0;
        for (const grapheme of graphemes(text)) {
            const next = graphemeWidth(grapheme);
            if (width + next > limit) break;
            result += grapheme;
            width += next;
        }
        return `${result}…`;
    }

    return { displayWidth, truncateWidth };
});
