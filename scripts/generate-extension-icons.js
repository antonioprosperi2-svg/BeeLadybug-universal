/**
 * Writes placeholder PNGs for the Chrome extension.
 * Replace extension/icons/icon16.png, icon48.png and icon128.png with the real art.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');

function crc32(buffer) {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let bit = 0; bit < 8; bit++) {
            const mask = -(crc & 1);
            crc = (crc >>> 1) ^ (0xedb88320 & mask);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const name = Buffer.from(type);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
    return Buffer.concat([length, name, data, crc]);
}

function png(size) {
    const raw = Buffer.alloc((size * 4 + 1) * size);
    const center = (size - 1) / 2;
    const radius = size * 0.46;
    const spots = [
        [-0.16, -0.12, 0.11],
        [0.16, -0.08, 0.09],
        [-0.05, 0.16, 0.1],
        [0.18, 0.18, 0.07]
    ];
    for (let y = 0; y < size; y++) {
        const row = y * (size * 4 + 1);
        raw[row] = 0;
        for (let x = 0; x < size; x++) {
            const dx = x - center;
            const dy = y - center;
            const pixel = row + 1 + x * 4;
            if (Math.hypot(dx, dy) > radius) continue;
            const nx = dx / size;
            const ny = dy / size;
            let dark = ny < -0.12;
            for (let s = 0; s < spots.length; s++) {
                const spot = spots[s];
                if (Math.hypot(nx - spot[0], ny - spot[1]) < spot[2]) dark = true;
            }
            const eye = !dark && ny < -0.02 && Math.abs(Math.abs(nx) - 0.12) < 0.045 && Math.abs(ny + 0.22) < 0.05;
            raw[pixel] = eye ? 255 : dark ? 18 : 255;
            raw[pixel + 1] = eye ? 243 : dark ? 8 : 59;
            raw[pixel + 2] = eye ? 214 : dark ? 10 : 78;
            raw[pixel + 3] = 255;
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

mkdirSync(root, { recursive: true });
for (const size of [16, 48, 128]) {
    writeFileSync(join(root, `icon${size}.png`), png(size));
}
