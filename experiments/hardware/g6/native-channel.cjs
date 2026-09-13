'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');

function deadline(promise, milliseconds, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
        promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
}
async function reservePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
}
async function createChannel(logPath) {
    const token = crypto.randomBytes(24).toString('hex'), records = [], waiters = new Set(), sockets = new Set();
    let socket, nextId = 0;
    const publish = message => {
        const record = { sequence: records.length, at: new Date().toISOString(), ...message };
        records.push(record); fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`);
        for (const waiter of [...waiters]) if (record.sequence >= waiter.after && waiter.type === record.type && waiter.predicate(record)) {
            clearTimeout(waiter.timer); waiters.delete(waiter); waiter.resolve(record);
        }
    };
    fs.writeFileSync(logPath, '', { flag: 'wx' });
    const server = net.createServer(connection => {
        sockets.add(connection); connection.setEncoding('utf8');
        let buffer = '', authenticated = false;
        connection.on('error', error => publish({ type: 'channelError', error: error.message }));
        connection.on('close', () => sockets.delete(connection));
        connection.on('data', chunk => {
            buffer += chunk;
            if (buffer.length > 8 * 1024 * 1024) { connection.destroy(new Error('Observer response exceeds 8MiB')); return; }
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
                if (!line) continue;
                try {
                    const message = JSON.parse(line);
                    if (!authenticated) {
                        assert.ok(message.type === 'hello' && message.token === token, 'Observer authentication failed');
                        assert.ok(!socket, 'Observer session is already connected'); socket = connection; authenticated = true;
                    } else publish(message);
                } catch (error) { connection.destroy(error); return; }
            }
        });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const waitFor = (type, predicate = () => true, timeout = 30000, after = 0) => {
        const existing = records.find(record => record.sequence >= after && record.type === type && predicate(record));
        if (existing) return Promise.resolve(existing);
        return new Promise((resolve, reject) => {
            const waiter = { type, predicate, after, resolve, reject };
            waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(new Error(`Observer ${type} timed out`)); }, timeout);
            waiters.add(waiter);
        });
    };
    return { port: server.address().port, token, records, waitFor,
        async request(action, payload = {}, timeout = 30000) {
            assert.ok(socket && !socket.destroyed, 'Observer is not connected');
            const id = `driver-${++nextId}`, message = { id, action, payload }, serialized = JSON.stringify(message);
            assert.ok(Buffer.byteLength(serialized) <= 1024 * 1024, 'Observer request exceeds 1MiB');
            const response = waitFor('response', value => value.id === id, timeout, records.length);
            publish({ type: 'driverInput', id, action, payload }); socket.write(`${serialized}\n`);
            const result = await response;
            assert.equal(result.status, 'ok', result.error || 'Observer failed');
            return result.result;
        },
        async close() {
            for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.reject(new Error('Observer closed')); }
            waiters.clear(); for (const connection of sockets) connection.destroy();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
    };
}

async function findWebview(context, selector = '#viewport', timeout = 30000) {
    return new Promise((resolve, reject) => {
        const pages = new Map(), pending = new Set(); let done = false;
        const cleanup = () => { clearTimeout(timer); context.off('page', attach); for (const [page, listener] of pages) {
            page.off('frameattached', listener); page.off('framenavigated', listener);
        } };
        const inspect = async frame => {
            if (done || pending.has(frame) || !frame.url().startsWith('vscode-webview:')) return;
            pending.add(frame);
            try {
                await frame.locator(selector).waitFor({ state: 'attached', timeout });
                if (!done) { done = true; cleanup(); resolve({ frame, page: frame.page() }); }
            } catch { pending.delete(frame); }
        };
        const attach = page => { const listener = frame => { void inspect(frame); }; pages.set(page, listener);
            page.on('frameattached', listener); page.on('framenavigated', listener); for (const frame of page.frames()) listener(frame);
        };
        const timer = setTimeout(() => { done = true; cleanup(); reject(new Error(`Native Webview ${selector} not found`)); }, timeout);
        context.on('page', attach); for (const page of context.pages()) attach(page);
    });
}
module.exports = { deadline, reservePort, createChannel, findWebview };
