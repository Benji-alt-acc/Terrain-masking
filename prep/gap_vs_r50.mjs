// How much of the AOI is dark because of range gaps vs terrain shadow, by R50.
//
// "Dark" = under 50% chance of detection per km flown. For each R50 and altitude:
//   range_gap        - dark with terrain masking OFF (sensor spacing alone)
//   all_dark         - dark with terrain masking ON
//   edge_strip_dark  - all_dark within 1.5 km of the AOI edge
// Two configurations, both scored on AOI cells only:
//   "AOI only"        - iteration 1: 12 sensors, grid = AOI (nothing modelled outside)
//   "Buffered domain" - iteration 2: 30 sensors, grid = AOI + 5 km buffer
// Max range = 2.5 x R50 (per-km detection < 1% beyond 2.4 x R50).
//
// Usage: node prep/gap_vs_r50.mjs   -> data/domain/gap_vs_r50.csv
import {readFile, writeFile} from "node:fs/promises";
import {pathToFileURL, fileURLToPath} from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, "js", f)));
const vs = await imp("viewshed.js"), det = await imp("detection.js");
const load = async (p) => { const b = await readFile(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

const R50S = [2000, 2250, 2500, 2750, 3000, 3250, 3500], ALTS = [50, 150, 300], MAST = 10;
const VIEW_RANGE = 2.5 * Math.max(...R50S);

const AOI_LAYOUT = [[267675,5202105],[272445,5201265],[278475,5202255],[281805,5202255],[268605,5194065],[273615,5192505],[276705,5192985],[283635,5194485],[268605,5187105],[273135,5187465],[278085,5184945],[281085,5185245]];
const DOMAIN_LAYOUT = [[263625,5207115],[268605,5207445],[273615,5205495],[278385,5207595],[280635,5207325],[288495,5206545],[263625,5202165],[267675,5202105],[272445,5201265],[278475,5202255],[281805,5202255],[286365,5201985],[260925,5191695],[268605,5194065],[273615,5192505],[276705,5192985],[283635,5194485],[286905,5193795],[261315,5185485],[268605,5187105],[273135,5187465],[278085,5184945],[281085,5185245],[285645,5185965],[260625,5179785],[268485,5182575],[273405,5181885],[278625,5182065],[282195,5182425],[287295,5179575]];

const configs = [
  {name: "AOI only", dir: "aoi", meta: "meta.json", dem: "dem.f32", layout: AOI_LAYOUT},
  {name: "Buffered domain", dir: "domain", meta: "domain_meta.json", dem: "domain_dem.f32", layout: DOMAIN_LAYOUT}
];

const rows = ["config,r50,altitude,metric,value"];
for (const cfg of configs) {
  const meta = JSON.parse(await readFile(path.join(root, "data", cfg.dir, cfg.meta), "utf8"));
  const dem = await load(path.join(root, "data", cfg.dir, cfg.dem));
  const W = meta.width, n = W * meta.height;
  const aoi = meta.aoi ?? {col: 0, row: 0, size: W};
  // AOI cells, and which of them lie in the 1.5 km edge strip.
  const cells = [], strip = [];
  for (let r = aoi.row; r < aoi.row + aoi.size; r++) for (let c = aoi.col; c < aoi.col + aoi.size; c++) {
    const i = r * W + c, e = Math.min(c - aoi.col, r - aoi.row, aoi.col + aoi.size - 1 - c, aoi.row + aoi.size - 1 - r);
    cells.push(i);
    if (e * meta.cell_m < 1500) strip.push(i);
  }
  const t0 = performance.now();
  const sensors = cfg.layout.map(([x, y]) => ({
    x, y, z0: vs.groundElevation(dem, meta, x, y) + MAST,
    minAGL: vs.minVisibleAGL(dem, meta, {x, y}, {height: MAST, maxRange: VIEW_RANGE})
  }));
  const zero = new Float32Array(n);
  console.log(`${cfg.name}: ${sensors.length} viewsheds in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  for (const r50 of R50S) {
    const p = {...det.defaults, r50};
    const terr = sensors.map((s) => ({...s, maxRange: 2.5 * r50}));
    const flat = terr.map((s) => ({...s, minAGL: zero}));
    for (const A of ALTS) {
      const ht = det.hazardField(dem, meta, terr, A, p), hf = det.hazardField(dem, meta, flat, A, p);
      const dark = (h, idx) => idx.filter((i) => 1 - Math.exp(-1000 * h[i]) < 0.5).length / idx.length;
      for (const [metric, v] of [["range_gap", dark(hf, cells)], ["all_dark", dark(ht, cells)], ["edge_strip_dark", dark(ht, strip)]]) {
        rows.push(`${cfg.name},${r50},${A},${metric},${v.toFixed(4)}`);
      }
    }
    console.log(`  R50 ${r50}: done`);
  }
}
await writeFile(path.join(root, "data", "domain", "gap_vs_r50.csv"), rows.join("\n") + "\n");
console.log(`${rows.length - 1} rows -> data/domain/gap_vs_r50.csv`);
