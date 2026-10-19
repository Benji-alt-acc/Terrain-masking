// Notional detection model (plan §2b, §4 steps 3-4). Illustrative parameters only.
//
// Per sensor and cell, at flight altitude A (m AGL):
//   - 0 if terrain-masked (A <= min visible AGL), outside [minRange, maxRange],
//     or outside the elevation coverage [elMin, elMax];
//   - else per-scan Pd = Pfa^(1 / (1 + SNR))  (Swerling I),
//     SNR = S50 * (rcs / rcsRef) * (r50 / R)^4 * ramp,
//     with S50 chosen so Pd = 0.5 at slant range r50 for the reference RCS,
//     and ramp = min(1, (A - minAGL) / rampWidth) softening the masking edge.
// Hazard per metre flown: h = sum_i -ln(1 - Pd_i) / (speed * scanTime).
// Sensors are assumed independent (summing hazards).
//
// Self-contained (no imports) so it can be loaded from an Observable attachment.
// Sensor records: {x, y, z0 (antenna elevation, m), maxRange, minAGL (Float32Array, NaN = out of range)}.
// minAGL may extend past maxRange (e.g. computed once for the largest range in use);
// detection is cut off at maxRange (horizontal distance) regardless.

export const defaults = {
  r50: 2000,       // m, per-scan 50% detection range for the reference RCS
  rcs: 0.01,       // m^2, target radar cross-section (0.01 = small quadcopter)
  rcsRef: 0.01,    // m^2, RCS the r50 anchor refers to
  pfa: 1e-6,       // false-alarm probability per resolution cell
  rampWidth: 20,   // m of clearance over which SNR ramps up from the masking line
  minRange: 100,   // m, blind zone around the sensor
  elMin: -20,      // deg, elevation coverage
  elMax: 50,
  speed: 15,       // m/s, drone speed
  scanTime: 1,     // s per scan
  pdMax: 0.999     // clamp so -ln(1 - Pd) stays finite
};

// Per-scan Pd for one sensor at slant range R (m) with masking clearance (m).
export function pdScan(R, clearance, p = defaults) {
  if (!(clearance > 0)) return 0;
  const s50 = Math.log(p.pfa) / Math.log(0.5) - 1;
  const snr = s50 * (p.rcs / p.rcsRef) * (p.r50 / R) ** 4 * Math.min(1, clearance / p.rampWidth);
  return Math.min(p.pdMax, Math.exp(Math.log(p.pfa) / (1 + snr)));
}

// Hazard per metre flown, given per-scan Pd.
export const hazardOf = (pd, p = defaults) => -Math.log1p(-pd) / (p.speed * p.scanTime);

// Add one sensor's hazard (per metre) at altitude A into h (Float32Array, one value per cell).
export function addSensorHazard(h, dem, grid, s, A, p = defaults) {
  const {width: W, height: H, cell_m: cell, xmin, ymax} = grid;
  const sc = (s.x - xmin) / cell - 0.5, sr = (ymax - s.y) / cell - 0.5;
  const rc = s.maxRange / cell;
  const tanMin = Math.tan(p.elMin * Math.PI / 180), tanMax = Math.tan(p.elMax * Math.PI / 180);
  const c0 = Math.max(0, Math.floor(sc - rc)), c1 = Math.min(W - 1, Math.ceil(sc + rc));
  const r0 = Math.max(0, Math.floor(sr - rc)), r1 = Math.min(H - 1, Math.ceil(sr + rc));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * W + c, m = s.minAGL[i];
      if (Number.isNaN(m) || A <= m) continue;
      const hd = Math.hypot((c - sc) * cell, (r - sr) * cell);
      if (hd < p.minRange || hd > s.maxRange) continue;
      const dz = dem[i] + A - s.z0;
      if (dz < tanMin * hd || dz > tanMax * hd) continue;
      const pd = pdScan(Math.hypot(hd, dz), A - m, p);
      if (pd > 0) h[i] += hazardOf(pd, p);
    }
  }
  return h;
}

// Total hazard per metre for all sensors at altitude A.
export function hazardField(dem, grid, sensors, A, p = defaults) {
  const h = new Float32Array(grid.width * grid.height);
  for (const s of sensors) addSensorHazard(h, dem, grid, s, A, p);
  return h;
}

// Lowest minimum visible AGL over all sensors (NaN where no sensor is in range).
export function combinedMinAGL(sensors, n) {
  const out = new Float32Array(n).fill(NaN);
  for (const s of sensors) {
    const m = s.minAGL;
    for (let i = 0; i < n; i++) {
      const v = m[i];
      if (v < out[i] || (Number.isNaN(out[i]) && !Number.isNaN(v))) out[i] = v;
    }
  }
  return out;
}
