'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { collectFiles, writeZip } = require('./zip');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'dist', `${manifest.name}-${manifest.version}.vsix`);
const runtimeRoots = new Set(['src', 'media']);
const runtimeFiles = new Set(['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE']);

const entries = collectFiles(root, {
    prefix: 'extension',
    include(relativePath) {
        const first = relativePath.split('/')[0];
        return runtimeRoots.has(first) || runtimeFiles.has(relativePath);
    },
    exclude(relativePath, entry) {
        return entry.isDirectory() && ['dist', 'test', 'examples', 'docs', 'scripts', '.vscode', '.github', 'node_modules'].includes(relativePath.split('/')[0]);
    }
});
entries.push({ name: 'extension.vsixmanifest', data: makeVsixManifest(manifest) });
entries.push({ name: '[Content_Types].xml', data: makeContentTypes() });

const result = writeZip(output, entries);
console.log(`vsix: ${path.relative(root, result.outputPath)} (${result.entries} files, ${result.bytes} bytes)`);

function makeVsixManifest(pkg) {
    const categories = (pkg.categories || []).join(',');
    const tags = (pkg.keywords || []).join(',');
    return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}" />
    <DisplayName>${xml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(pkg.description)}</Description>
    <Tags>${xml(tags)}</Tags>
    <Categories>${xml(categories)}</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/media/icon.png" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

function makeContentTypes() {
    return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="xml" ContentType="text/xml" />
</Types>
`;
}

function xml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
