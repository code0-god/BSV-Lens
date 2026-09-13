#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');
const { once } = require('node:events');
const { parseArguments, launchNative, launchDevelopment } = require('./native-driver.cjs');
const { createChannel } = require('./native-channel.cjs');

async function main() {
    const runs = path.resolve(__dirname, '../../../.build/hardware/runs'); fs.mkdirSync(runs, { recursive: true });
    const output = path.join(fs.mkdtempSync(path.join(runs, 'g6-native-harness-')), 'g6'); fs.mkdirSync(output);
    const receipt = { schema: 'g6-native-harness-check-v1', scope: 'Test driver infrastructure only; no product/native acceptance',
        startedAt: new Date().toISOString(), tests: [], status: 'running' };
    const check = async (name, execute) => { await execute(); receipt.tests.push({ name, status: 'passed' }); };
    let channel, client, lines;
    try {
        await check('required CLI paths', () => assert.deepEqual(parseArguments(['--vsix', 'a.vsix', '--workspace', 'workspace', '--output', 'run/g6', '--restricted']),
            { vsix: 'a.vsix', workspace: 'workspace', output: 'run/g6', restricted: true }));
        await check('unknown/missing/duplicate CLI options rejected', () => {
            for (const input of [[], ['--vsix'], ['--unknown', 'a'], ['--vsix', 'a', '--vsix', 'b']]) assert.throws(() => parseArguments(input));
        });
        await check('installed and development entrypoints never fall back', async () => {
            await assert.rejects(launchNative({ developmentRoot: 'source' }), /requires VSIX/);
            await assert.rejects(launchNative({ vsix: 'a.vsix', developmentRoot: 'source' }), /forbids developmentRoot/);
            await assert.rejects(launchDevelopment({ vsix: 'a.vsix' }), /requires explicit developmentRoot/);
            await assert.rejects(launchDevelopment({ vsix: 'a.vsix', developmentRoot: 'source' }), /forbids VSIX/);
        });
        channel = await createChannel(path.join(output, 'channel-events.jsonl'));
        await check('foreign observer token rejected', async () => {
            const foreign = net.createConnection({ host: '127.0.0.1', port: channel.port });
            await once(foreign, 'connect'); const closed = once(foreign, 'close');
            foreign.write(`${JSON.stringify({ type: 'hello', token: 'foreign-test-token' })}\n`); await closed;
            const rejected = await channel.waitFor('channelError'); assert.match(rejected.error, /Observer authentication failed/);
        });
        client = net.createConnection({ host: '127.0.0.1', port: channel.port }); await once(client, 'connect');
        lines = readline.createInterface({ input: client });
        lines.on('line', line => { const message = JSON.parse(line); client.write(`${JSON.stringify({ type: 'response', id: message.id, status: 'ok', result: { action: message.action } })}\n`); });
        await check('authenticated event delivery', async () => {
            client.write(`${JSON.stringify({ type: 'hello', token: channel.token })}\n${JSON.stringify({ type: 'observerReady', probe: true })}\n`);
            assert.equal((await channel.waitFor('observerReady')).probe, true);
        });
        await check('request identity roundtrip', async () => assert.deepEqual(await channel.request('probe-only'), { action: 'probe-only' }));
        await check('oversized driver request rejected', async () => assert.rejects(channel.request('probe-only', { text: 'x'.repeat(1048576) }), /exceeds 1MiB/));
        await check('missing event times out', async () => assert.rejects(channel.waitFor('absent', () => true, 10), /timed out/));
        await check('auth nonce excluded from recorded evidence', () => assert.equal(fs.readFileSync(path.join(output, 'channel-events.jsonl'), 'utf8').includes(channel.token), false));
        await check('close rejects pending waits and settles sockets', async () => {
            const pending = assert.rejects(channel.waitFor('not-coming'), /Observer closed/);
            await channel.close(); channel = null; await pending;
        });
        receipt.status = 'passed';
    } catch (error) { receipt.status = 'failed'; receipt.error = error?.stack || String(error); process.exitCode = 1; }
    finally {
        lines?.close(); client?.destroy(); await channel?.close(); receipt.finishedAt = new Date().toISOString();
        receipt.pass = receipt.tests.length; receipt.fail = receipt.status === 'failed' ? 1 : 0;
        fs.writeFileSync(path.join(output, 'harness-check.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
        console.log(JSON.stringify({ output, status: receipt.status, pass: receipt.pass, fail: receipt.fail }));
    }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
