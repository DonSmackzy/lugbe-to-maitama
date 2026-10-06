// scripts/generate-tileset.js
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WIDTH = 256;
const HEIGHT = 64;

// 8 tiles: 4 per row, 2 rows. Each tile is 64x32 isometric diamond.
const tileColors = [
  // Row 0
  [179, 84, 34],   // 0: Lugbe red earth (laterite)
  [55, 65, 81],    // 1: Expressway asphalt
  [107, 114, 128], // 2: Wuse commercial pavement
  [234, 88, 12],   // 3: Central Market booth
  // Row 1
  [156, 163, 175], // 4: Garki Secretariat granite
  [21, 128, 61],   // 5: Green buffer zone
  [4, 120, 87],    // 6: Maitama manicured lawns
  [30, 41, 59],    // 7: Aso Villa apex perimeter
];

// Create raw RGBA buffer
const rawData = Buffer.alloc(HEIGHT * (1 + WIDTH * 4));

for (let y = 0; y < HEIGHT; y++) {
  const rowOffset = y * (1 + WIDTH * 4);
  rawData[rowOffset] = 0; // Filter type 0 (None)

  const tileRow = Math.floor(y / 32);
  const localY = y % 32;

  for (let x = 0; x < WIDTH; x++) {
    const tileCol = Math.floor(x / 64);
    const localX = x % 64;
    const tileIndex = tileRow * 4 + tileCol;

    const pxOffset = rowOffset + 1 + x * 4;

    // Check if pixel is inside the isometric diamond:
    // Center is (32, 16). Distance: |dx / 32| + |dy / 16| <= 1
    const dx = Math.abs(localX - 31.5);
    const dy = Math.abs(localY - 15.5);
    const insideDiamond = (dx / 32) + (dy / 16) <= 1.0;

    if (insideDiamond) {
      const baseColor = tileColors[tileIndex] || [100, 100, 100];
      let [r, g, b] = baseColor;

      // Add subtle top-down shading on isometric facets
      if (localY < 16) {
        r = Math.min(255, r + 20);
        g = Math.min(255, g + 20);
        b = Math.min(255, b + 20);
      } else {
        r = Math.max(0, r - 15);
        g = Math.max(0, g - 15);
        b = Math.max(0, b - 15);
      }

      // Expressway yellow dividing line (tile 1)
      if (tileIndex === 1 && localX >= 30 && localX <= 33) {
        r = 250; g = 204; b = 21; // Yellow line
      }

      // Aso Villa gold trim (tile 7)
      if (tileIndex === 7 && (dx / 32) + (dy / 16) >= 0.85) {
        r = 245; g = 158; b = 11; // Gold security perimeter
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = 255;
    } else {
      // Transparent outside diamond
      rawData[pxOffset] = 0;
      rawData[pxOffset + 1] = 0;
      rawData[pxOffset + 2] = 0;
      rawData[pxOffset + 3] = 0;
    }
  }
}

// Compress data with DEFLATE (zlib)
const compressedData = zlib.deflateSync(rawData);

// PNG Builder
function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);

  const body = Buffer.concat([typeBuf, data]);
  const crc = crc32(body);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([len, body, crcBuf]);
}

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr.writeUInt8(8, 8); // bit depth 8
ihdr.writeUInt8(6, 9); // RGBA (color type 6)
ihdr.writeUInt8(0, 10);
ihdr.writeUInt8(0, 11);
ihdr.writeUInt8(0, 12);

const ihdrChunk = makeChunk("IHDR", ihdr);
const idatChunk = makeChunk("IDAT", compressedData);
const iendChunk = makeChunk("IEND", Buffer.alloc(0));

const pngBuffer = Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);

const outPath = path.resolve(__dirname, "../public/assets/tiles/abuja_tiles.png");
fs.writeFileSync(outPath, pngBuffer);
console.log(`Successfully generated isometric tileset PNG at: ${outPath} (${pngBuffer.length} bytes)`);
