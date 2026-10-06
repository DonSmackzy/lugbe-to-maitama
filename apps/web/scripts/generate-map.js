// scripts/generate-map.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WIDTH = 120;
const HEIGHT = 120;
const totalTiles = WIDTH * HEIGHT;
const data = new Array(totalTiles);

// Tile GIDs:
// 1 = Lugbe Red Earth / Dust
// 2 = Dual Carriage Expressway Asphalt
// 3 = Wuse Commercial Pavement
// 4 = Market Booth / Stall
// 5 = Garki Civil Service Pavement
// 6 = Maitama Manicured Lawn
// 7 = Maitama Executive Marble
// 8 = The Villa High-Security Apex Perimeter
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const idx = y * WIDTH + x;
    
    // Main Expressway Arteries (Airport Road & Shehu Shagari Way)
    if (x === 30 || x === 60 || x === 90 || y === 30 || y === 60 || y === 90) {
      data[idx] = 2; // Asphalt Expressway
    } else if (x >= 90 && y >= 90) {
      data[idx] = 8; // The Villa (Apex)
    } else if (x >= 60 && y >= 60) {
      data[idx] = 7; // Maitama (Executive Core)
    } else if (x >= 60 && y < 30) {
      data[idx] = 5; // Garki (Secretariat)
    } else if (x >= 30 && x < 60 && y < 60) {
      data[idx] = 3; // Wuse (Commercial Midtown)
    } else if (x < 30 && y < 30) {
      data[idx] = 1; // Lugbe (Satellite Dust & Hustle)
    } else if (y >= 90 && x < 60) {
      data[idx] = 1; // Karu / Nyanya Satellite
    } else {
      data[idx] = 6; // Green Buffer / Hills
    }
  }
}

const tiledMap = {
  compressionlevel: -1,
  height: HEIGHT,
  width: WIDTH,
  infinite: false,
  orientation: "isometric",
  renderorder: "right-down",
  tileheight: 32,
  tilewidth: 64,
  type: "map",
  version: "1.10",
  tiledversion: "1.10.2",
  tilesets: [
    {
      firstgid: 1,
      name: "abuja_tiles",
      tilewidth: 64,
      tileheight: 32,
      tilecount: 8,
      columns: 4,
      image: "/assets/tiles/abuja_tiles.png",
      imagewidth: 256,
      imageheight: 64,
      tiles: [
        { id: 0, properties: [{ name: "district", type: "string", value: "lugbe" }] },
        { id: 1, properties: [{ name: "district", type: "string", value: "expressway" }] },
        { id: 2, properties: [{ name: "district", type: "string", value: "wuse" }] },
        { id: 3, properties: [{ name: "district", type: "string", value: "market" }] },
        { id: 4, properties: [{ name: "district", type: "string", value: "garki" }] },
        { id: 5, properties: [{ name: "district", type: "string", value: "buffer" }] },
        { id: 6, properties: [{ name: "district", type: "string", value: "maitama" }] },
        { id: 7, properties: [{ name: "district", type: "string", value: "the_villa" }] }
      ]
    }
  ],
  layers: [
    {
      id: 1,
      name: "Ground",
      type: "tilelayer",
      visible: true,
      opacity: 1,
      x: 0,
      y: 0,
      width: WIDTH,
      height: HEIGHT,
      data
    }
  ]
};

const outPath = path.resolve(__dirname, "../public/assets/maps/abuja_isometric_map.json");
fs.writeFileSync(outPath, JSON.stringify(tiledMap, null, 2));
console.log(`Successfully generated 120x120 Tiled isometric map at: ${outPath}`);
