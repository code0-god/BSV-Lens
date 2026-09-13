'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { translate } = require('../../media/hardware-strings');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function hardwareHtml(webview, extensionUri, vscode, build) {
    const nonce = randomBytes(24).toString('base64');
    const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'none'; base-uri 'none'; form-action 'none';`;
    const language = vscode.env?.language || 'en';
    const values = { csp, nonce, language, buildId: build.buildId, protocol: build.protocol };
    for (const name of ['hardware.css', 'hardware-strings.js', 'hardware-native.js', 'hardware-navigation.js', 'hardware-layout.js', 'hardware-readability.js',
        'hardware-analysis.js', 'hardware-inspector.js', 'hardware-view.js']) values[name] = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name)).toString();
    return fs.readFileSync(path.join(extensionUri.fsPath, 'media/hardware-native.html'), 'utf8')
        .replace(/\{\{([^}]+)\}\}/g, (_, key) => {
            if (key.startsWith('text.')) return escape(translate(language, key.slice(5)));
            if (!(key in values)) throw new Error(`Unknown native HTML placeholder: ${key}`);
            return escape(values[key]);
        });
}
module.exports = { hardwareHtml };
