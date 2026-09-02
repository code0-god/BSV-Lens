'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CRC_TABLE = makeCrcTable();
const DEFAULT_DATE = new Date(process.env.SOURCE_DATE_EPOCH
    ? Number(process.env.SOURCE_DATE_EPOCH) * 1000
    : '2026-09-02T00:00:00Z');

function writeZip(outputPath, entries) {
    const normalized = entries
        .map(normalizeEntry)
        .sort((left, right) => left.name.localeCompare(right.name));
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of normalized) {
        const name = Buffer.from(entry.name, 'utf8');
        const content = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
        const compressed = zlib.deflateRawSync(content, { level: 9 });
        const checksum = crc32(content);
        const { date, time } = dosDateTime(entry.date || DEFAULT_DATE);
        const flags = 0x0800;
        const method = 8;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(content.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        localParts.push(local, name, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(0x0314, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(flags, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(time, 12);
        central.writeUInt16LE(date, 14);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(content.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        const mode = entry.mode || 0o100644;
        central.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, name);

        offset += local.length + name.length + compressed.length;
    }

    const centralOffset = offset;
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(normalized.length, 8);
    eocd.writeUInt16LE(normalized.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralOffset, 16);
    eocd.writeUInt16LE(0, 20);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.concat([...localParts, ...centralParts, eocd]));
    return { outputPath, entries: normalized.length, bytes: fs.statSync(outputPath).size };
}

function collectFiles(root, options = {}) {
    const entries = [];
    const prefix = options.prefix ? `${normalizeName(options.prefix).replace(/\/$/, '')}/` : '';
    walk(root, '');
    return entries;

    function walk(current, relative) {
        const children = fs.readdirSync(current, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const child of children) {
            const childRelative = relative ? `${relative}/${child.name}` : child.name;
            const fullPath = path.join(current, child.name);
            if (options.exclude?.(childRelative, child)) continue;
            if (child.isDirectory()) {
                walk(fullPath, childRelative);
            } else if (child.isFile()) {
                if (options.include && !options.include(childRelative, child)) continue;
                const stat = fs.statSync(fullPath);
                entries.push({
                    name: `${prefix}${normalizeName(childRelative)}`,
                    data: fs.readFileSync(fullPath),
                    mode: stat.mode,
                    date: options.date || DEFAULT_DATE
                });
            }
        }
    }
}

function normalizeEntry(entry) {
    if (!entry || !entry.name || entry.data === undefined) throw new Error('ZIP entries require name and data.');
    return {
        ...entry,
        name: normalizeName(entry.name).replace(/^\/+/, '')
    };
}

function normalizeName(value) {
    return String(value).replace(/\\/g, '/');
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        table[index] = value >>> 0;
    }
    return table;
}

function dosDateTime(value) {
    const date = new Date(value);
    const year = Math.max(1980, date.getUTCFullYear());
    const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
    const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
    return { date: dosDate, time: dosTime };
}

module.exports = {
    collectFiles,
    crc32,
    writeZip
};
