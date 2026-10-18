// Minimum visible altitude for one ground sensor (plan §4 step 2).
//
// For every cell within maxRange, the lowest height above ground (m AGL) at
// which a target is in the sensor's line of sight. 0 = visible at ground level;
// larger = deeper terrain shadow (more room to fly underneath). NaN = out of range.
//
// Method: straight ray from the sensor to each cell centre, sampling the DEM
// (bilinear) every cell length; the steepest terrain angle along the ray sets
// the height needed at the target. Earth curvature with refraction factor k
// (4/3 = standard radar atmosphere) lowers distant terrain by d^2 / (2 k R).
// Same quantity as `gdal_viewshed -om GROUND`.
//
// Grid conventions follow prep/clip_aoi.py meta.json: row-major, row 0 = north,
// cell centres at xmin + (col + 0.5) * cell, ymax - (row + 0.5) * cell.

const R_EARTH = 6371000;

export function minVisibleAGL(dem, grid, sensor, {height = 10, maxRange = 6000, k = 4 / 3} = {}) {
  const {width: W, height: H, cell_m: cell, xmin, ymax} = grid;
  // Sensor position in fractional cell coordinates (cell centres at integers).
  const sc = (sensor.x - xmin) / cell - 0.5, sr = (ymax - sensor.y) / cell - 0.5;
  if (!(sc >= -0.5 && sc <= W - 0.5 && sr >= -0.5 && sr <= H - 0.5)) throw new Error("sensor outside grid");
  const z0 = bilinear(dem, W, H, sc, sr) + height;
  const curv = 1 / (2 * k * R_EARTH);
  const rCells = maxRange / cell;

  const out = new Float32Array(W * H).fill(NaN);
  const c0 = Math.max(0, Math.floor(sc - rCells)), c1 = Math.min(W - 1, Math.ceil(sc + rCells));
  const r0 = Math.max(0, Math.floor(sr - rCells)), r1 = Math.min(H - 1, Math.ceil(sr + rCells));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const dc = c - sc, dr = r - sr, dist = Math.hypot(dc, dr);
      if (dist > rCells) continue;
      // Samples at 1, 2, ... cells along the ray, stopping half a cell short of the target.
      const n = Math.floor(dist - 0.5);
      let tmax = -Infinity;
      for (let i = 1; i <= n; i++) {
        const d = i * cell;
        const z = bilinear(dem, W, H, sc + dc / dist * i, sr + dr / dist * i) - curv * d * d;
        const t = (z - z0) / d;
        if (t > tmax) tmax = t;
      }
      const D = dist * cell, idx = r * W + c;
      const need = n > 0 ? z0 + tmax * D + curv * D * D : -Infinity;
      out[idx] = Math.max(0, need - dem[idx]);
    }
  }
  return out;
}

// Ground elevation (m) at a projected point, bilinear between cell centres.
export function groundElevation(dem, grid, x, y) {
  const {width: W, height: H, cell_m: cell, xmin, ymax} = grid;
  return bilinear(dem, W, H, (x - xmin) / cell - 0.5, (ymax - y) / cell - 0.5);
}

function bilinear(a, W, H, x, y) {
  x = Math.min(Math.max(x, 0), W - 1);
  y = Math.min(Math.max(y, 0), H - 1);
  const x0 = Math.min(Math.floor(x), W - 2), y0 = Math.min(Math.floor(y), H - 2);
  const fx = x - x0, fy = y - y0, i = y0 * W + x0;
  return (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + W] * (1 - fx) + a[i + W + 1] * fx) * fy;
}
