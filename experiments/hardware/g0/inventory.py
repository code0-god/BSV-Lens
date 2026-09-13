"""Read-only local artifact inventory; extraction stays inside the G0 evidence directory."""
import hashlib
import json
from pathlib import Path
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.build/hardware/g0'
OUT.mkdir(parents=True, exist_ok=True)
REPORT = {'auditArchives': [], 'missingRequestedArchives': [], 'installed': []}


def sha(data):
    return hashlib.sha256(data).hexdigest()


for name in [
    'bsv-lens-0.4.1-system-code-audit.zip',
    'bsv-lens-0.4.1-system-code-audit (1).zip',
    'bsv-lens-c6b9a5c-focus-review.zip',
    'bsv-lens-c6b9a5c-independent-check.zip',
]:
    archive = Path.home() / 'Downloads' / name
    if not archive.exists():
        REPORT['missingRequestedArchives'].append(str(archive))
        continue
    with zipfile.ZipFile(archive) as zipped:
        members = []
        extraction = (OUT / 'archive' / archive.stem).resolve()
        for member in zipped.infolist():
            if member.is_dir():
                continue
            target = (extraction / member.filename).resolve()
            if not target.is_relative_to(extraction) or stat.S_ISLNK(member.external_attr >> 16):
                raise ValueError(f'Unsafe archive member: {member.filename}')
            if member.file_size > 2_000_000:
                raise ValueError(f'Oversize audit member: {member.filename}')
            data = zipped.read(member)
            members.append({'name': member.filename, 'size': member.file_size, 'sha256': sha(data)})
            # Inspect only audit text/scripts. Never execute archived probes (they use sleeps).
            if target.suffix in {'.md', '.json', '.py', '.cjs', '.js', '.txt', '.log'}:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        REPORT['auditArchives'].append({'path': str(archive), 'sha256': sha(archive.read_bytes()), 'members': members})

vsix = ROOT / 'dist/bsv-lens-0.4.1.vsix'
with zipfile.ZipFile(vsix) as zipped:
    crc_error = zipped.testzip()
    names = set(zipped.namelist())
    for version in ['0.4.0', '0.4.1']:
        installed = Path.home() / '.vscode/extensions' / f'code0-god.bsv-lens-{version}'
        matching, different = [], []
        for area in ['src', 'media']:
            for source in sorted((installed / area).rglob('*')):
                if not source.is_file():
                    continue
                relative = source.relative_to(installed).as_posix()
                member = 'extension/' + relative
                if member not in names:
                    different.append({'path': relative, 'status': 'absent-in-vsix'})
                    continue
                item = {'path': relative, 'installedSha256': sha(source.read_bytes()), 'vsixSha256': sha(zipped.read(member))}
                (matching if item['installedSha256'] == item['vsixSha256'] else different).append(item)
        REPORT['installed'].append({'versionDirectory': version, 'path': str(installed),
            'comparedAgainst': 'dist/bsv-lens-0.4.1.vsix', 'matchingRuntimeFiles': matching,
            'differentRuntimeFiles': different, 'metadataPresent': (installed / 'media/build-metadata.js').exists()})
    checkout_comparison = [
        {'path': name[len('extension/'):], 'equalCheckout':
            (ROOT / name[len('extension/'):]).read_bytes() == zipped.read(name)}
        for name in sorted(names)
        if name.startswith(('extension/src/', 'extension/media/')) and not name.endswith('/')
    ]

report = {**REPORT, 'vsix': {'path': str(vsix), 'sha256': sha(vsix.read_bytes()),
    'crcError': crc_error, 'checkoutComparison': checkout_comparison}}
(OUT / 'identity.json').write_text(json.dumps(report, indent=2) + '\n')
print('identity.json: archive hashes, safe text extraction, VSIX CRC, installed/runtime equality recorded')
assert crc_error is None
assert all(item['equalCheckout'] for item in checkout_comparison)
assert not REPORT['installed'][1]['differentRuntimeFiles']
