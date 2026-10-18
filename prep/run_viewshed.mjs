// CLI wrapper around js/viewshed.js for validation and batch runs.
// Usage: node prep/run_viewshed.mjs <aoi_dir> <out.f32> <x> <y> [height=10] [maxRange=6000]
// Writes the min-visible-AGL raster (Float32 LE, NaN = out of range) on the AOI grid.
import {readFile, writeFile} from "node:fs/promises";
import {pathToFileURL, fileURLToPath} from "node:url";
import path from "node:path";

const {minVisibleAGL} = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "../js/viewshed.js")));
const [aoi, out, x, y, height = 10, maxRange = 6000] = process.argv.slice(2);
const meta = JSON.parse(await readFile(path.join(aoi, "meta.json"), "utf8"));
const b = await readFile(path.join(aoi, "dem.f32"));
const dem = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const m = minVisibleAGL(dem, meta, {x: +x, y: +y}, {height: +height, maxRange: +maxRange});
await writeFile(out, Buffer.from(m.buffer));
