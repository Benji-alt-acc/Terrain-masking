// Least-exposure routing on the hazard field (plan §4 steps 5-7).
//
// Graph: one node per cell, 16-connected (straight, diagonal and knight moves,
// so routes can bend at ~26.6° steps instead of only 45°). Edge cost =
// step length × (mean hazard of the cells the step passes through + lengthPenalty).
// With lengthPenalty = 0 the summed cost is -ln P(survive undetected), and
// since it is additive Dijkstra finds the exact optimum on this graph.
//
// Self-contained (no imports) so it can be loaded from an Observable attachment.
// Grid conventions follow prep/clip_aoi.py meta.json (row 0 = north).

// [dc, dr, intermediate cells crossed (dc, dr offsets)]
const MOVES = [];
for (const [dc, dr] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) MOVES.push({dc, dr, mid: []});
for (const sx of [1, -1]) for (const sy of [1, -1]) {
  MOVES.push({dc: sx, dr: 2 * sy, mid: [[0, sy], [sx, sy]]});
  MOVES.push({dc: 2 * sx, dr: sy, mid: [[sx, 0], [sx, sy]]});
}

// Dijkstra from one cell. Returns {dist (cost to every cell), prev (predecessor index)}.
// Costs are symmetric, so dist from the goal is also the cost-to-go to the goal.
// target: stop once this cell is settled (-1 = settle every cell).
export function dijkstra(hazard, grid, source, {target = -1, lengthPenalty = 0} = {}) {
  const {width: W, height: H, cell_m: cell} = grid, n = W * H;
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  const moves = MOVES.map((m) => ({...m, len: Math.hypot(m.dc, m.dr) * cell, k: 2 + m.mid.length}));
  // A* toward the target: every step costs at least lengthPenalty per metre, so
  // lengthPenalty x straight-line distance is an admissible, consistent heuristic
  // (exact result, fewer cells settled). Zero (plain Dijkstra) without a target.
  const tc = target % W, tr = (target - tc) / W;
  const hOf = target >= 0 && lengthPenalty > 0
    ? (v) => lengthPenalty * cell * Math.hypot(v % W - tc, Math.floor(v / W) - tr)
    : () => 0;
  dist[source] = 0;
  heap.push(source, hOf(source));
  while (heap.size) {
    const f = heap.minKey, u = heap.pop(), d = dist[u];
    if (f > d + hOf(u) + 1e-9) continue;
    if (u === target) break;
    const uc = u % W, ur = (u - uc) / W;
    for (const m of moves) {
      const vc = uc + m.dc, vr = ur + m.dr;
      if (vc < 0 || vc >= W || vr < 0 || vr >= H) continue;
      const v = vr * W + vc;
      let hs = hazard[u] + hazard[v];
      for (const [mc, mr] of m.mid) hs += hazard[(ur + mr) * W + uc + mc];
      const nd = d + m.len * (hs / m.k + lengthPenalty);
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(v, nd + hOf(v));
      }
    }
  }
  return {dist, prev};
}

// Least-exposure route between two projected points ({x, y}, UTM m).
// Returns {points: [[x, y], ...] (cell centres), cost}.
export function leastExposureRoute(hazard, grid, start, goal, {lengthPenalty = 0} = {}) {
  const {width: W, cell_m: cell, xmin, ymax} = grid;
  const toIndex = (p) => Math.floor((ymax - p.y) / cell) * W + Math.floor((p.x - xmin) / cell);
  const s = toIndex(start), g = toIndex(goal);
  const {dist, prev} = dijkstra(hazard, grid, s, {target: g, lengthPenalty});
  const cells = [];
  for (let v = g; v !== -1; v = prev[v]) cells.push(v);
  cells.reverse();
  const points = cells.map((i) => [xmin + (i % W + 0.5) * cell, ymax - (Math.floor(i / W) + 0.5) * cell]);
  let length = 0;
  for (let k = 1; k < points.length; k++) length += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
  return {points, cost: dist[g], length};
}

// Least-exposure route no longer than maxLength (m): an endurance limit.
// Lagrangian relaxation: find the smallest extra per-metre penalty (on top of
// lengthPenalty) whose optimal route fits, by growing then bisecting it in log
// space. Exact when the limit is not binding; otherwise the best route on the
// penalty/length trade-off curve that fits (may miss a slightly better route
// in the curve's gaps). Returns {points, cost, length, penalty, binding, runs}.
export function leastExposureRouteWithin(hazard, grid, start, goal, maxLength, {lengthPenalty = 0, iterations = 4} = {}) {
  let runs = 1, best = leastExposureRoute(hazard, grid, start, goal, {lengthPenalty});
  if (best.length <= maxLength) return {...best, penalty: lengthPenalty, binding: false, runs};
  // Grow the extra penalty from ~1% of the route's mean hazard until the route fits.
  let lo = 0, hi = Math.max(1e-9, 0.01 * best.cost / best.length), fit = null;
  for (; runs < 40; hi *= 4) {
    const r = leastExposureRoute(hazard, grid, start, goal, {lengthPenalty: lengthPenalty + hi});
    runs++;
    if (r.length <= maxLength) { fit = r; break; }
    lo = hi;
  }
  if (!fit) throw new Error("no route within the length limit");
  for (let k = 0; k < iterations; k++) {
    const mid = lo > 0 ? Math.sqrt(lo * hi) : hi / 4;
    const r = leastExposureRoute(hazard, grid, start, goal, {lengthPenalty: lengthPenalty + mid});
    runs++;
    if (r.length <= maxLength) { fit = r; hi = mid; } else lo = mid;
  }
  return {...fit, penalty: lengthPenalty + hi, binding: true, runs};
}

// Score any polyline on the hazard field by sampling every `step` metres
// (nearest cell). Used for both routes so they are compared the same way.
// Returns {length, cumHazard, pSurvive, profile: [{d, pDetected, cumHazard}]} with d in metres
// flown. cumHazard = -ln P(survive) = expected number of detections (stays finite
// when pSurvive underflows to 0, so use it to compare heavily covered routes).
export function evaluateRoute(points, hazard, grid, {step = 5} = {}) {
  const {width: W, height: H, cell_m: cell, xmin, ymax} = grid;
  let length = 0, logS = 0;
  const profile = [{d: 0, pDetected: 0, cumHazard: 0}];
  for (let k = 1; k < points.length; k++) {
    const [x0, y0] = points[k - 1], [x1, y1] = points[k];
    const L = Math.hypot(x1 - x0, y1 - y0), m = Math.max(1, Math.ceil(L / step)), ds = L / m;
    for (let j = 0; j < m; j++) {
      const t = (j + 0.5) / m;
      const c = Math.min(W - 1, Math.max(0, Math.floor((x0 + t * (x1 - x0) - xmin) / cell)));
      const r = Math.min(H - 1, Math.max(0, Math.floor((ymax - (y0 + t * (y1 - y0))) / cell)));
      logS += hazard[r * W + c] * ds;
      length += ds;
      profile.push({d: length, pDetected: 1 - Math.exp(-logS), cumHazard: logS});
    }
  }
  return {length, cumHazard: logS, pSurvive: Math.exp(-logS), profile};
}

class MinHeap {
  constructor(cap = 1 << 16) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
    this.size = 0;
  }
  get minKey() { return this.keys[0]; }
  push(v, key) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2), a = new Int32Array(this.size * 2);
      k.set(this.keys); a.set(this.vals);
      this.keys = k; this.vals = a;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p]; this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = key; this.vals[i] = v;
  }
  pop() {
    const top = this.vals[0], key = this.keys[--this.size], v = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c]; this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = key; this.vals[i] = v;
    return top;
  }
}
