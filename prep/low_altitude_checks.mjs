// Low-altitude robustness checks (iteration 2 setup: buffered domain, 30 sensors,
// R50 3 km, max range 7.5 km, mast 10 m, endurance limit 2x straight line).
//
//   ramp: clearance ramp width 0 / 10 / 20 / 40 m on the 30 m DEM. At 10-30 m AGL
//         the default 20 m ramp is as large as the altitude, so check sensitivity.
//   dem:  30 m vs 10 m DEM (ramp 20 m). Hazard is computed on the 10 m grid, then
//         averaged over each 3 x 3 block so routes run on the same 30 m graph;
//         dark_frac is measured on the native 10 m cells.
//
// Metrics per setting and altitude (AOI cells / AOI start-goal pairs):
//   dark_frac  share of the AOI with < 50% detection chance per km flown
//   e_terrain, e_range   expected detections on the terrain-aware and range-only
//                        routes (both endurance-limited, both scored on terrain-aware hazard)
//   saving     1 - e_terrain / e_range, per pair
//
// Usage: node prep/low_altitude_checks.mjs   -> data/domain/low_altitude_checks.csv (~15 min)
import {readFile, writeFile} from "node:fs/promises";
import {pathToFileURL, fileURLToPath} from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, "js", f)));
const vs = await imp("viewshed.js"), det = await imp("detection.js"), rt = await imp("route.js");
const load = async (p) => { const b = await readFile(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

const ALTS = [10, 20, 30, 50, 100], RAMPS = [0, 10, 20, 40], MAST = 10, R50 = 3000, MAX_RANGE = 2.5 * R50;
const DETOUR = 2, N_PAIRS = 10, MIN_SEP = 8000, EDGE_MARGIN = 1000, SEED = 42;
const LAYOUT = [[263625,5207115],[268605,5207445],[273615,5205495],[278385,5207595],[280635,5207325],[288495,5206545],[263625,5202165],[267675,5202105],[272445,5201265],[278475,5202255],[281805,5202255],[286365,5201985],[260925,5191695],[268605,5194065],[273615,5192505],[276705,5192985],[283635,5194485],[286905,5193795],[261315,5185485],[268605,5187105],[273135,5187465],[278085,5184945],[281085,5185245],[285645,5185965],[260625,5179785],[268485,5182575],[273405,5181885],[278625,5182065],[282195,5182425],[287295,5179575]];

const meta30 = JSON.parse(await readFile(path.join(root, "data/domain/domain_meta.json"), "utf8"));
const dem30 = await load(path.join(root, "data/domain/domain_dem.f32"));
const meta10 = JSON.parse(await readFile(path.join(root, "data/domain10/domain_meta.json"), "utf8"));
const dem10 = await load(path.join(root, "data/domain10/domain_dem.f32"));
const n30 = meta30.width * meta30.height;

// Random start-goal pairs inside the AOI (fixed seed), at least MIN_SEP apart.
let s = SEED;
const rand = () => ((s = (s + 0x6D2B79F5) | 0), (((s ^ (s >>> 15)) * (1 | s)) >>> 0) / 2 ** 32);
const {aoi} = meta30, pairs = [];
while (pairs.length < N_PAIRS) {
  const pt = () => ({x: aoi.xmin + EDGE_MARGIN + rand() * (aoi.xmax - aoi.xmin - 2 * EDGE_MARGIN),
                     y: aoi.ymin + EDGE_MARGIN + rand() * (aoi.ymax - aoi.ymin - 2 * EDGE_MARGIN)});
  const a = pt(), b = pt();
  if (Math.hypot(a.x - b.x, a.y - b.y) >= MIN_SEP) pairs.push([a, b]);
}

const aoiCells = (meta) => {
  const out = [], W = meta.width, a = meta.aoi;
  for (let r = a.row; r < a.row + a.size; r++) for (let c = a.col; c < a.col + a.size; c++) out.push(r * W + c);
  return out;
};
const AOI30 = aoiCells(meta30), AOI10 = aoiCells(meta10);
const darkFrac = (h, cells) => cells.reduce((k, i) => k + (1 - Math.exp(-1000 * h[i]) < 0.5), 0) / cells.length;

const rows = ["check,setting,altitude,pair,metric,value"];
const emit = (check, setting, A, pair, metric, v) => rows.push(`${check},${setting},${A},${pair},${metric},${v.toFixed(5)}`);
const routePairs = (check, setting, A, hT, hR) => {
  pairs.forEach(([a, b], k) => {
    const lim = DETOUR * Math.hypot(b.x - a.x, b.y - a.y);
    const eT = rt.evaluateRoute(rt.leastExposureRouteWithin(hT, meta30, a, b, lim).points, hT, meta30).cumHazard;
    const eR = rt.evaluateRoute(rt.leastExposureRouteWithin(hR, meta30, a, b, lim).points, hT, meta30).cumHazard;
    emit(check, setting, A, k, "e_terrain", eT);
    emit(check, setting, A, k, "e_range", eR);
    emit(check, setting, A, k, "saving", 1 - eT / eR);
  });
};
const sensorsOn = (dem, meta) => LAYOUT.map(([x, y]) => ({x, y, maxRange: MAX_RANGE, z0: vs.groundElevation(dem, meta, x, y) + MAST}));
const t0 = performance.now(), elapsed = () => `${((performance.now() - t0) / 1000).toFixed(0)} s`;

// ---- ramp sweep, 30 m DEM ----
const S30 = sensorsOn(dem30, meta30).map((sn) => ({...sn, minAGL: vs.minVisibleAGL(dem30, meta30, sn, {height: MAST, maxRange: MAX_RANGE})}));
const zero30 = new Float32Array(n30);
console.log(`30 m viewsheds done (${elapsed()})`);
for (const ramp of RAMPS) {
  const p = {...det.defaults, r50: R50, rampWidth: ramp};
  for (const A of ALTS) {
    const hT = det.hazardField(dem30, meta30, S30, A, p);
    const hR = det.hazardField(dem30, meta30, S30.map((sn) => ({...sn, minAGL: zero30})), A, p);
    emit("ramp", ramp, A, -1, "dark_frac", darkFrac(hT, AOI30));
    routePairs("ramp", ramp, A, hT, hR);
    console.log(`ramp ${ramp} m, ${A} m AGL (${elapsed()})`);
  }
}
// The 30 m DEM baseline is the ramp-20 run.
for (const row of rows.filter((r) => r.startsWith("ramp,20,"))) rows.push(row.replace("ramp,20,", "dem,30 m,"));

// ---- 10 m DEM (ramp 20 m): accumulate hazard one sensor at a time to bound memory ----
const p20 = {...det.defaults, r50: R50, rampWidth: 20};
const n10 = meta10.width * meta10.height, zero10 = new Float32Array(n10);
const H10 = Object.fromEntries(ALTS.map((A) => [A, {hT: new Float32Array(n10), hR: new Float32Array(n10)}]));
for (const sn of sensorsOn(dem10, meta10)) {
  const m = vs.minVisibleAGL(dem10, meta10, sn, {height: MAST, maxRange: MAX_RANGE});
  for (const A of ALTS) {
    det.addSensorHazard(H10[A].hT, dem10, meta10, {...sn, minAGL: m}, A, p20);
    det.addSensorHazard(H10[A].hR, dem10, meta10, {...sn, minAGL: zero10}, A, p20);
  }
}
console.log(`10 m hazards done (${elapsed()})`);
const toCoarse = (h) => {  // mean over each 3 x 3 block -> 30 m grid
  const W = meta10.width, Wc = meta30.width, out = new Float32Array(n30);
  for (let r = 0; r < Wc; r++) for (let c = 0; c < Wc; c++) {
    let sum = 0;
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) sum += h[(3 * r + dr) * W + 3 * c + dc];
    out[r * Wc + c] = sum / 9;
  }
  return out;
};
for (const A of ALTS) {
  emit("dem", "10 m", A, -1, "dark_frac", darkFrac(H10[A].hT, AOI10));
  routePairs("dem", "10 m", A, toCoarse(H10[A].hT), toCoarse(H10[A].hR));
  console.log(`10 m DEM, ${A} m AGL routes (${elapsed()})`);
}

await writeFile(path.join(root, "data/domain/low_altitude_checks.csv"), rows.join("\n") + "\n");
console.log(`${rows.length - 1} rows -> data/domain/low_altitude_checks.csv (${elapsed()})`);
