// Hypothesis batch (plan §1b): terrain along least-exposure vs comparison routes.
//
// For each randomized sensor layout x random AOI start-goal pair x altitude, plan
//   terrain  - least exposure on the terrain-aware hazard
//   range    - least exposure with terrain masking off (control: isolates terrain from range)
//   straight - straight line (shortest route at fixed AGL)
// Both planned routes use the endurance limit (DETOUR x straight-line distance).
// Every route is scored on the terrain-aware hazard and on path-averaged terrain
// metrics (sampled every 5 m, nearest cell, whole route including buffer).
//
// Setup = iteration 2: buffered domain, R50 3 km, max range 7.5 km, mast 10 m,
// ramp 20 m. Layouts: one sensor per iteration-2 block (30), placed at a random
// cell among the top 20% of elevations in the block's central 60% (plausible
// high ground, not always the summit). Seeds are fixed per layout.
//
// Usage: node prep/hypothesis_batch.mjs <firstLayout> <lastLayout>
//   -> data/batch/routes_<L>.csv and data/batch/layout_<L>.json per layout
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {pathToFileURL, fileURLToPath} from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, "js", f)));
const vs = await imp("viewshed.js"), det = await imp("detection.js"), rt = await imp("route.js");
const load = async (f) => { const b = await readFile(path.join(root, "data/domain", f)); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

const ALTS = [10, 20, 30, 50, 100, 150, 300];
const MAST = 10, R50 = 3000, MAX_RANGE = 2.5 * R50, RAMP = 20, DETOUR = 2;
const N_PAIRS = 20, MIN_SEP = 8000, EDGE_MARGIN = 1000, SAMPLE_STEP = 5;
const METRICS = ["slope", ...[150, 500, 1500].flatMap((r) => [`relief_${r}`, `tpi_${r}`, `dev_${r}`])];

const [first, last] = process.argv.slice(2).map(Number);
const meta = JSON.parse(await readFile(path.join(root, "data/domain/domain_meta.json"), "utf8"));
const W = meta.width, H = meta.height, cell = meta.cell_m, {aoi} = meta;
const dem = await load("domain_dem.f32");
const terrain = Object.fromEntries(await Promise.all(METRICS.map(async (m) => [m, await load(`domain_${m}.f32`)])));
const outDir = path.join(root, "data/batch");
await mkdir(outDir, {recursive: true});

const rng = (seed) => () => ((seed = (seed + 0x6D2B79F5) | 0), (((seed ^ (seed >>> 15)) * (1 | seed)) >>> 0) / 2 ** 32);

// Iteration-2 blocks: AOI split 4 x 3, plus a ring of 5 km buffer blocks.
const B = aoi.col, A = aoi.size;
const colEdges = [0, B, B + Math.floor(A / 4), B + Math.floor(A / 2), B + Math.floor(3 * A / 4), B + A, W];
const rowEdges = [0, B, B + Math.floor(A / 3), B + Math.floor(2 * A / 3), B + A, H];
function makeLayout(rand) {
  const sensors = [];
  for (let j = 0; j < rowEdges.length - 1; j++) for (let i = 0; i < colEdges.length - 1; i++) {
    const c0 = colEdges[i], c1 = colEdges[i + 1], r0 = rowEdges[j], r1 = rowEdges[j + 1];
    const mc = Math.floor((c1 - c0) / 5), mr = Math.floor((r1 - r0) / 5), cells = [];
    for (let r = r0 + mr; r < r1 - mr; r++) for (let c = c0 + mc; c < c1 - mc; c++) cells.push(r * W + c);
    cells.sort((a, b) => dem[b] - dem[a]);
    const k = cells[Math.floor(rand() * Math.ceil(0.2 * cells.length))];
    sensors.push({x: meta.xmin + (k % W + 0.5) * cell, y: meta.ymax - (Math.floor(k / W) + 0.5) * cell});
  }
  return sensors;
}
function makePairs(rand) {
  const pairs = [];
  const pt = () => ({x: aoi.xmin + EDGE_MARGIN + rand() * (aoi.xmax - aoi.xmin - 2 * EDGE_MARGIN),
                     y: aoi.ymin + EDGE_MARGIN + rand() * (aoi.ymax - aoi.ymin - 2 * EDGE_MARGIN)});
  while (pairs.length < N_PAIRS) {
    const a = pt(), b = pt();
    if (Math.hypot(a.x - b.x, a.y - b.y) >= MIN_SEP) pairs.push([a, b]);
  }
  return pairs;
}

// Path averages of every terrain metric, plus the share of the route in the buffer.
function routeTerrain(points) {
  const sums = Object.fromEntries(METRICS.map((m) => [m, 0]));
  let len = 0, buffer = 0;
  for (let k = 1; k < points.length; k++) {
    const [x0, y0] = points[k - 1], [x1, y1] = points[k];
    const L = Math.hypot(x1 - x0, y1 - y0), m = Math.max(1, Math.ceil(L / SAMPLE_STEP)), ds = L / m;
    for (let j = 0; j < m; j++) {
      const t = (j + 0.5) / m, x = x0 + t * (x1 - x0), y = y0 + t * (y1 - y0);
      const c = Math.min(W - 1, Math.max(0, Math.floor((x - meta.xmin) / cell)));
      const r = Math.min(H - 1, Math.max(0, Math.floor((meta.ymax - y) / cell)));
      const i = r * W + c;
      for (const name of METRICS) sums[name] += terrain[name][i] * ds;
      if (x < aoi.xmin || x > aoi.xmax || y < aoi.ymin || y > aoi.ymax) buffer += ds;
      len += ds;
    }
  }
  return {frac_buffer: buffer / len, ...Object.fromEntries(METRICS.map((m) => [m, sums[m] / len]))};
}

const p = {...det.defaults, r50: R50, rampWidth: RAMP};
const header = ["layout", "pair", "altitude", "route", "length_m", "e_det", "binding", "frac_buffer", ...METRICS];
for (let L = first; L <= last; L++) {
  const t0 = performance.now();
  const layout = makeLayout(rng(1000 + L)), pairs = makePairs(rng(2000 + L));
  await writeFile(path.join(outDir, `layout_${L}.json`), JSON.stringify({layout: L, sensors: layout, pairs}));
  const sensors = layout.map((s) => ({...s, maxRange: MAX_RANGE, z0: vs.groundElevation(dem, meta, s.x, s.y) + MAST,
                                      minAGL: vs.minVisibleAGL(dem, meta, s, {height: MAST, maxRange: MAX_RANGE})}));
  const zero = new Float32Array(W * H), flat = sensors.map((s) => ({...s, minAGL: zero}));
  const rows = [header.join(",")];
  const emit = (pair, A, name, pts, hT, binding) => {
    const e = rt.evaluateRoute(pts, hT, meta), tm = routeTerrain(pts);
    rows.push([L, pair, A, name, e.length.toFixed(0), e.cumHazard.toFixed(4), binding ? 1 : 0, tm.frac_buffer.toFixed(4),
               ...METRICS.map((m) => tm[m].toFixed(4))].join(","));
  };
  for (const A of ALTS) {
    const hT = det.hazardField(dem, meta, sensors, A, p), hR = det.hazardField(dem, meta, flat, A, p);
    pairs.forEach(([a, b], k) => {
      const lim = DETOUR * Math.hypot(b.x - a.x, b.y - a.y);
      const rT = rt.leastExposureRouteWithin(hT, meta, a, b, lim), rR = rt.leastExposureRouteWithin(hR, meta, a, b, lim);
      emit(k, A, "terrain", rT.points, hT, rT.binding);
      emit(k, A, "range", rR.points, hT, rR.binding);
      emit(k, A, "straight", [[a.x, a.y], [b.x, b.y]], hT, false);
    });
  }
  await writeFile(path.join(outDir, `routes_${L}.csv`), rows.join("\n") + "\n");
  console.log(`layout ${L}: ${rows.length - 1} routes in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}
