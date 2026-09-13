'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { collectFiles, writeZip } = require('../../../scripts/zip');
const delivery = require('./validate-delivery');
const root = path.resolve(__dirname, '../../..');
const historicalDirectories = ['g0', 'importer', 'prototype', 'bsv-model', 'bsv-ui',
    'bsv-evidence', 'bsv-ui/rtl-regression', 'g2-product', 'g3-a'].map(name => `.build/hardware/${name}`);

function collectEntries({ workspace = root, sourceOnly = false } = {}) {
    return collectFiles(workspace, { prefix: 'bsv-lens', exclude(relative, entry) {
        if (['g5', 'g5-readability', 'g6', 'g6-usability'].some(gate => relative === `docs/hardware/evidence/${gate}`)) return true;
        if (delivery.forbidden(relative)) return true;
        if (relative.split('/')[0] === '.build') {
            if (sourceOnly) return true;
            if (['.build', '.build/hardware', ...historicalDirectories].includes(relative)) return false;
            if (historicalDirectories.some(directory => relative.startsWith(`${directory}/`))) {
                return entry.isDirectory() || !/\.(json|md|txt|tap|png|svg)$/.test(relative);
            }
            return !/^\.build\/hardware\/lead-(?:bsv-)?final-[^/]+\.png$/.test(relative);
        }
        // Inventory-required historical logs and new G4 receipts are shipped.
        return entry.isFile() && relative.endsWith('.log') && !relative.startsWith('docs/hardware/evidence/');
    } });
}

function saveCandidate(output, entries) {
    delivery.assertNewOutput(output);
    const result = writeZip(output, entries); // Caller owns a fresh unique run directory.
    const sha256 = delivery.hash(fs.readFileSync(output));
    fs.writeFileSync(`${output}.sha256`, `${sha256}  ${path.basename(output)}\n`, { flag: 'wx' });
    return { ...result, sha256 };
}

// Stage mode writes ONLY run-local candidates. No final dist names are touched.
// A final publication stages/replays these exact bytes first, then links them once.
function stage({ workspace = root, python, report, retainExtraction = false } = {}) {
    const entries = collectEntries({ workspace });
    const source = entries.filter(entry => !entry.name.startsWith('bsv-lens/.build/'));
    const members = [delivery.validateEntries(entries, false, workspace, { report }),
        delivery.validateEntries(source, true, workspace, { report })];
    assert.deepEqual(members[0].runtime, members[1].runtime);
    const directory = delivery.createRun(workspace);
    const archives = ['review', 'source'].map(mode => path.join(directory, `${mode}.zip`));
    saveCandidate(archives[0], entries); saveCandidate(archives[1], source);
    const validations = delivery.validateDelivery({ workspace, archives, python, report,
        retainExtraction, runDirectory: directory });
    const result = { schema: 'g4-package-stage-v1', directory, archives, status: 'pass',
        finalArchivesCreated: false, report: report || null,
        browser: validations[0].browser, validations: validations.map(({ archive, sha256, status }) => ({ archive, sha256, status })) };
    fs.writeFileSync(path.join(directory, 'stage.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    return result;
}

function build({ workspace = root, report, python, retainExtraction = false } = {}) {
    assert.ok(report, 'Final packaging requires --report with the current G4 report path; use --stage while acceptance is in progress');
    const outputs = delivery.archiveNames(workspace);
    for (const output of outputs) delivery.assertNewOutput(output);
    const staged = stage({ workspace, report, python, retainExtraction });
    for (const output of outputs) delivery.assertNewOutput(output);
    fs.mkdirSync(path.join(workspace, 'dist'), { recursive: true });
    const published = [];
    for (const [index, output] of outputs.entries()) {
        const candidate = staged.archives[index];
        const validation = JSON.parse(fs.readFileSync(`${candidate}.validation.json`, 'utf8'));
        assert.equal(validation.status, 'pass');
        assert.equal(delivery.hash(fs.readFileSync(candidate)), validation.sha256, 'Validated candidate changed before publication');
        // linkSync is exclusive: a competing invocation cannot overwrite an archive.
        fs.linkSync(candidate, output);
        fs.writeFileSync(`${output}.sha256`, `${validation.sha256}  ${path.basename(output)}\n`, { flag: 'wx' });
        const finalReceipt = { ...validation, archive: output, validatedCandidate: candidate,
            stageReceipt: path.join(staged.directory, 'stage.json'), publication: 'exclusive-link-of-validated-bytes' };
        const text = `${JSON.stringify(finalReceipt, null, 2)}\n`;
        fs.writeFileSync(`${output}.validation.json`, text, { flag: 'wx' });
        fs.writeFileSync(`${output}.validation.json.sha256`, `${delivery.hash(text)}  ${path.basename(output)}.validation.json\n`, { flag: 'wx' });
        published.push({ archive: output, sha256: validation.sha256, status: 'pass' });
    }
    return { stage: staged.directory, archives: published };
}

const usage = `G4 packaging (Node/Python standard libraries only):
  node experiments/hardware/g4/package.js --preflight
  node experiments/hardware/g4/package.js --stage [--retain-extraction] [--report docs/hardware/g4/REPORT.md]
  node experiments/hardware/g4/package.js --build --report docs/hardware/g4/REPORT.md

--preflight validates the current member/capture/runtime closure without writing ZIPs.
--stage writes review.zip/source.zip ONLY under a fresh .build/hardware/runs/g4-delivery-*.
It replays shipped G2/G3 and G4 scene/navigation/layout/server tests and public HTTP queries,
with runtime-only PATH, no node_modules/global module lookup, and exactly 14 expected
missing author companions. Browser tests are shipped but remain an optional dependency lane.
--build performs the same stage validation before publishing the final G4 dist names ONCE.
Existing archives, checksum/validation receipts (including dangling links) are never replaced.
No compiler execution, dependency install, workflow/version change, or historical writes.`;

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes('--help')) console.log(usage);
    else {
        try {
            const modes = args.filter(arg => ['--preflight', '--stage', '--build'].includes(arg));
            assert.equal(modes.length, 1, usage);
            let report;
            const rest = args.filter(arg => !modes.includes(arg) && arg !== '--retain-extraction');
            if (rest.length) {
                assert.equal(rest.length, 2, usage); assert.equal(rest[0], '--report', usage);
                report = rest[1]; assert.ok(!report.startsWith('--'), usage);
            }
            const options = { report, retainExtraction: args.includes('--retain-extraction') };
            let result;
            if (modes[0] === '--preflight') {
                const review = collectEntries(), source = review.filter(entry => !entry.name.startsWith('bsv-lens/.build/'));
                result = [review, source].map((entries, index) => {
                    const members = delivery.validateEntries(entries, !!index, root, options);
                    return { mode: index ? 'source' : 'review', members: members.members, g4: members.g4 };
                });
            } else result = modes[0] === '--stage' ? stage(options) : build(options);
            console.log(JSON.stringify(result, null, 2));
        } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
    }
}
module.exports = { collectEntries, saveCandidate, stage, build, assertNewOutput: delivery.assertNewOutput };
