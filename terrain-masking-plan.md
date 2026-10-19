# Terrain Masking & Least-Exposure Routing: Project Plan (ROUGH)

Status: draft outline. Update as decisions are made.

## 1. Goal
Data visualization project (must include raster data) relevant to defense autonomy. Using real terrain rasters, model where notional ground-based sensors can "see" low-altitude vehicles, then compute a route that minimizes exposure. Deliver as an Observable notebook (or Observable Framework project).

Framing: a simplified terrain-masking (line-of-sight) model on public data. NOT a realistic threat assessment. Sensor sites are notional. Do not use real military installations or real operational parameters.

## 1b. Hypothesis
**H1:** In a bounded region watched by ground-based line-of-sight sensors, least-exposure routes for a low-altitude vehicle pass through terrain with significantly lower relative topographic position (valleys, draws, lee sides of ridges) and higher local relief than shortest-distance routes between the same endpoints. The effect holds across randomized sensor layouts, weakens as flight altitude (AGL) increases, and the terrain scale that best predicts concealment grows with altitude.

**H0:** Terrain metrics along least-exposure routes do not differ from those along shortest-distance routes.

Terrain metrics (all computed from the DEM, at multiple radii r = 150 m, 500 m, 1.5 km):
- **Local relief:** max - min elevation within radius r. Measures how much vertical structure is nearby (does not distinguish ridge from valley).
- **TPI:** elevation(c) - mean elevation within radius r. Relative, not absolute: negative = lower than surroundings (valley/depression), positive = ridge/knob. Scale-dependent: a divot on a ridge is negative at small r, positive at large r.
- **DEV:** TPI / std(elevation within r). Normalized TPI so dips are comparable across gentle and rugged terrain. Preferred for cross-scale comparison.
- **Slope:** pointwise steepness ("tight contours"). Expected weak/mixed effect: sensor-facing steep slopes are highly exposed, and flat valley floors are well hidden.
- (Secondary, sensor-dependent) aspect relative to nearest sensor: expected strongest predictor; supports "concealment is relational, not intrinsic."

Key scale reasoning: a feature only conceals a vehicle if it is deeper than the vehicle's AGL (a 10 m divot hides nothing at 50 m AGL), so the useful r should grow with altitude.

Test design:
- N sensor layouts (random + greedy-placed) x M random start-goal pairs, at AGL = 50 / 150 / 300 m.
- For each pair: path-averaged metric on least-exposure route vs. straight/shortest route. Paired Wilcoxon signed-rank test; report effect size per (metric, r, AGL).
- Main result chart: effect size vs. radius r, one line per altitude.
- KDE use: smooth cells used by all simulated paths into a path-density raster (visual + candidate w(c) weights for §5). NOT used for detection probability; a pure distance kernel ignores terrain and makes the hypothesis trivially false.

Caveat: the detection model is derived from the same DEM being tested, so this is a simulation study of what LOS geometry favors, not an empirical finding.

## 1c. Hypothesis result (2026-10-19)
Batch: `prep/hypothesis_batch.mjs` (10 randomized layouts x 20 AOI pairs x 7 altitudes 10-300 m, iteration 2 setup, endurance 2x; 4200 routes) -> `prep/hypothesis_stats.py` -> `data/batch/hypothesis_effects.csv`, `exposure_summary.csv`, `output/hypothesis_effects.png`.
- **H0 rejected.** Terrain-aware routes run through lower relative elevation and more relief than both the range-only control and the straight line, at every altitude. Strongest at r = 150 m: rank-biserial vs range-only DEV -0.73 to -0.88, TPI -0.75 to -0.89, relief +0.72 to +0.80; all Holm-significant, 10/10 layouts agree in sign for DEV/TPI (9-10 for relief), layout-level Wilcoxon p <= 0.006.
- **Weakens with altitude: supported in magnitude, not in consistency.** Median DEV_150 difference halves from -0.107 (20 m) to -0.052 (300 m); relief_150 from +25 m to +14 m; exposure saved vs range-only falls from 89% (10 m) to 44% (300 m). The rank effect size stays high because routes still prefer local lows at every altitude.
- **Scale grows with altitude: not supported.** 150 m is the strongest radius for DEV/TPI at every altitude (relief shifts to 500 m only at 150-300 m). At r = 1.5 km, DEV/TPI are POSITIVE vs range-only below 300 m: routes hide in small drainages within the higher, dissected hills rather than on the broad valley floor, which is flat and visible to many sensors.
- Caveats: endurance limit binds for 53-98% of terrain-aware routes (median length 1.7x straight); 21% of terrain-aware routes enter the buffer; detection model derived from the same DEM (simulation study, not an empirical finding); pairs within a layout share sensors (hence the layout-level check).

## 2. Open decisions (fill in)
- [ ] Deadline / required scope: ____
- [x] Area of interest: Missoula, MT. 40 x 40 km window fetched at 30 m (`prep/fetch_dem.py` -> `data/dem_missoula_30m.tif`, EPSG:32612). Terrain variety checked (`prep/terrain_metrics.py`): good mix of flat valley floor, canyons, and dissected ridges. Final 20 km sub-AOI (2026-10-17): cols 416:1083, rows 382:1049 of the 40 km grid (667 x 667 cells), x 264630-284640, y 5183580-5203590 (EPSG:32612). Clipped by `prep/clip_aoi.py` -> `data/aoi/*.f32` + `meta.json`. Metrics are clipped from the full-grid run so large-radius windows are not truncated at the AOI edge.
- [x] Non-JS prep allowed, but keep as much as possible in JS.
- [ ] Static vs. interactive final product: ____
- [ ] Audience: class only, or also portfolio/employers: ____

## 2b. Decisions made
- Build order: hand-placed sensors first (get the core pipeline working), then add greedy-optimized placement.
- Sensor: generic notional ground-based X-band pulse-Doppler counter-UAS surveillance radar (mast-mounted, 3D). No real product or specs.
- Detection model (physically shaped, notionally parameterized): radar range equation SNR ∝ σ / r⁴, Swerling I per-scan Pd = Pfa^(1/(1+SNR)), Pfa = 1e-6. Single anchor = per-scan R50 for the reference RCS (default σ = 0.01 m² small quadcopter). Plus a clearance ramp on SNR near the masking line (A − A_min over ~20 m), min/max range, and elevation-coverage limits. Anchor is ILLUSTRATIVE; sweep it.
- Path cost is TIME-BASED (hazard rate): hazard_i(c) = -ln(1 - Pd_scan,i(c)) / (v · T_scan) per meter flown; step cost = step_length · Σ_i hazard_i. Summed path cost = -ln(P survive undetected). Additive, so Dijkstra/A* stays exact; diagonal steps correctly cost √2 more; drone speed v and scan time T_scan become analysis variables. Headline metric = probability of surviving undetected.
- Sensors assumed independent (summing hazards = independence). State this assumption.
- Scenario: AREA defense of the whole 20 × 20 km AOI (not point defense), to expose terrain variation across the Missoula valley. Many sensors needed (see §5 sensor count).
- Calibration note: with dwell accumulation, effective crossing range ≈ 1.7–1.8 × per-scan R50 (v = 15 m/s, T_scan = 1 s), and coverage edges in open terrain are sharp; soft edges come from terrain. Choose per-scan R50 ≈ 2 km so effective small-drone range ≈ 3.5 km.
- Attacker is assumed to know all sensor positions and the model exactly (pessimistic for defender). State this.
- Milestone 4 iteration 2 (2026-10-18), after iteration 1 routes threaded range gaps between sensors and hugged the AOI edge:
  - R50 default 3 km with max range tied to 2.5 x R50 (per-km detection < 1% beyond 2.4 x R50). Range-only gaps in the AOI drop from ~20% (R50 2 km) to 0% (R50 >= 2.75 km), so remaining dark area is terrain shadow. Chosen over adding sensors, because more sensors also add new lines of sight and real budgets limit sensor count.
  - Range-only control route (masking off, scored on the terrain-aware hazard). Terrain effect = terrain-aware vs range-only, not vs straight line.
  - Buffered routing domain: AOI + 5 km (`prep/clip_domain.py`, 1001 x 1001), sensors at the same block density in the buffer (30 total). AOI edge strip is now as dark as the interior (16% vs 15% at 50 m, R50 3 km; AOI-only: 24% vs 17%). Endpoints and analysis stay in the AOI.
  - Evidence: `prep/gap_vs_r50.mjs` -> `data/domain/gap_vs_r50.csv`.
  - Endurance limit (optional toggle, default 2x straight-line distance): below ~30 m AGL unlimited routes wander 100-140 km and hug the domain's outer edge (the buffer just moves the edge). `route.leastExposureRouteWithin` = Lagrangian relaxation (smallest extra per-metre penalty whose route fits). Default endpoints, terrain-aware vs range-only expected detections with the limit: 10 m 23.9 vs 30.7, 20 m 147 vs 179, 30 m 164 vs 191, 50 m 183 vs 206 (limit not binding at >= 50 m). Use a fixed detour factor in the hypothesis batch.
- Low-altitude checks (2026-10-19, `prep/low_altitude_checks.mjs` -> `data/domain/low_altitude_checks.csv`; iteration 2 setup, 10 random AOI pairs, endurance 2x). Terrain saving = 1 - terrain-aware / range-only expected detections.
  - DEM resolution: 10 m DEM (`prep/fetch_domain_10m.py`; hazard averaged to 30 m for routing) matches 30 m within 1 pt dark share and 0-4 pts median saving at 10-100 m AGL. 30 m grid is adequate.
  - Clearance ramp: dark share at 10 m AGL depends strongly on ramp width (23% at 0-10 m, 35% at 20 m, 51% at 40 m); negligible at >= 50 m. Median terrain saving is robust (72-78% at 10 m, 32-37% at 100 m for all widths) and falls with altitude for every width. Report absolute 10-20 m dark shares as ramp-dependent.
  - Saving > 0 for every pair, setting and altitude. Median saving across pairs (78% at 10 m, 50% at 50 m) is far higher than the default endpoints (22% / 11%), which are a hard case.
- Missoula County (or nearby) is acceptable as a NOTIONAL defended valley; not a realistic adversary scenario. Say so in the write-up.

## 3. Data
- Elevation: USGS 3DEP bare-earth DEM (~10 m national; 1 m lidar where available). For areas outside the US: Copernicus GLO-30.
- Optional context layers: OpenStreetMap roads/power lines (candidate sensor siting constraints), Sentinel-2 or NAIP imagery (base map), land cover (NLCD) for a vegetation/clutter penalty.
- Prep (Python, rasterio/GDAL): clip to AOI, reproject to a metric CRS (Montana State Plane or UTM 12N), resample to ~30 m for interactivity, export a small Float32 binary or GeoTIFF (target < ~20 MB for Observable attachments).
- Do NOT use Web Mercator pixel sizes for slope/LOS math (at ~47°N distances are stretched ~1.46x).

## 4. Processing pipeline (all rasters on the same grid)
1. DEM -> hillshade + slope (+ roughness)
2. Per sensor: **minimum visible altitude (AGL)** raster via radial sweep tracking horizon angle (include earth curvature, sensor height, max range). Cheaper and more useful than a binary viewshed: altitude slider = simple threshold.
3. Per-sensor per-scan Pd at altitude A: 0 if masked (minAlt_i(c) > A), outside min/max range, or outside elevation coverage; else Swerling I on SNR(slant range, σ) × clearance ramp
4. Hazard per meter: h(c) = Σ_i -ln(1 - Pd_i(c)) / (v · T_scan). Visualize h (or P detected per km flown) as a continuous field
5. Cost per step: step_length × h(c) (+ optional small slope/roughness term). Keep the survival term separate from terrain terms so the survival metric stays interpretable
6. Least-exposure path: A*/Dijkstra (binary heap) from start to goal
7. Comparison: straight-line vs. least-exposure path (length, P(survive undetected)); survival-probability profile along each path

## 5. Sensor placement (see discussion in chat)
- Sensor count (draft estimate, 2026-10-13): rough DEM check showed a sensor sees ~50% of its 3 km disk at 50 m AGL, ~65% at 150 m, ~77% at 300 m (ridge sites slightly better, valley sites worse). With ~3.5 km effective range: flat-earth hex packing ≈ 13 sensors; terrain-aware greedy for ~85% coverage at 150 m AGL ≈ 15–20 (estimate). Baseline N = 12, sweep N ∈ {6, 12, 18, 24} as an experiment axis. Confirm with a greedy coverage-vs-N curve once the viewshed code exists.
- Phase A (first): hand-placed notional sites on ridgelines/approach-corridor overlooks. This is the baseline layout.
- Phase B: candidate generation: high local maxima/ridgeline points with prominence, slope limits, within X km of roads/power (practical siting).
- Selection: greedy maximization of expected coverage, sum_c w(c) * (1 - prod_i(1 - P_i(c))). This objective is monotone submodular, so greedy has a (1 - 1/e) guarantee (mention in methods).
- Cell weights w(c): how plausible a cell is as an attacker route, e.g. frequency of use across planner routes between many random start-goal pairs. NOTE: candidate set, weights, altitude, and sensor parameters are all analyst choices, so describe the result as "a reasonable defender layout under these stated assumptions", NOT unbiased or realistic.
- Evaluate by the attacker-side metric: best achievable survival probability found by the planner, hand-placed vs. greedy-optimized. Coverage is the objective; path survival is the test.
- Optional: attacker-vs-defender loop (place sensors, plan route, re-place sensors against that route).
- Performance: precompute per-candidate min-altitude rasters once (Python or Web Worker) and save them; the greedy loop is then array math. Benchmark early, since this is untested.

## 6. Analysis outputs (the part that makes it good)
- Survival-probability vs. path length trade-off curve (sweep the weight on the survival term vs. distance/terrain terms)
- Sensitivity to detection-model parameters (R50, k, max range, sensor height)
- Continuous detection-probability field and along-path survival profile (main visuals)
- Masking-altitude raster: how flight altitude opens/closes hidden corridors
- Sensitivity: shift a sensor by a few hundred meters / change altitude, show corridor change
- Sensor-layout comparison (hand-placed vs. greedy-optimized)

## 7. Observable notebook structure
- Intro / framing and limitations
- Data + hillshade base map
- Single sensor viewshed / min-altitude demo (verify visually)
- Multi-sensor cumulative exposure + altitude slider
- Cost surface + path overlay
- Trade-off and sensitivity charts
- Methods and limitations

Tech: geotiff.js or binary FileAttachment, typed arrays, canvas ImageData for rasters, Observable Plot / SVG overlays. Web Worker for recompute if dragging sensors is sluggish. Recompute only when a sensor moves; altitude changes are just thresholds.

## 8. Milestones (minimum viable = steps 1-4)
1. Get/clip/reproject DEM, hillshade renders in notebook
2. One sensor min-altitude raster, sanity-checked
3. Multi-sensor exposure map with altitude slider
4. Cost surface + least-exposure path
5. Trade-off + sensitivity analysis
6. Sensor-placement optimization
7. Polish visuals and write-up

## 8b. Path-planning extensions (in this order, after milestones 1-4)
1. **Cost-to-go flow field:** run Dijkstra backward from the goal to get a cost-to-go raster (best achievable survival probability from EVERY cell). Its gradient is the optimal heading everywhere ("direction of least resistance" on the fly, computed exactly). Visualize as an arrow field and/or animated particles following it. Cheap; likely the strongest visual.
2. **3D altitude layers:** stack the grid into altitude layers (e.g. 50-500 m AGL in 50 m steps). Compute P_detect per layer from the existing per-sensor min-altitude rasters. Allow Dijkstra to move between layers with a climb/descent cost. Still exact optimum. ~10 layers x 670 x 670 = ~4.5M nodes: feasible in JS with typed arrays but benchmark; coarsen grid if needed.
3. **Smoothing (optional):** Theta* (any-angle) or spline-smooth the A* path to remove 8-direction zigzag. Turn-radius/climb-rate limits (hybrid A*, RRT*) are out of scope.
4. **PSO comparison (optional):** optimize spline control points with PSO, animate the swarm converging, and score against the Dijkstra optimum as ground truth. Framing: a metaheuristic evaluated against an exact baseline, NOT the primary method. PSO only genuinely beats exact search when cost isn't additive per cell (dwell-time detection, cooperating sensors, multi-drone separation, smooth dynamics); note this in the write-up.

## 9. Risks / caveats
- Bare-earth DEM ignores trees/buildings; LOS overstated for ground-level targets, less so for low-flying ones.
- Line of sight != detection (no RCS, propagation, clutter, sensor physics). The distance-decay model is still illustrative: R50 and k are arbitrary, not derived from public data. State this plainly.
- Independence assumption across sensors and perfect attacker knowledge both affect results; list them as limitations.
- Crisp coverage results can look more authoritative than the model justifies; keep the language hedged.
- Compute: start ~20 x 20 km at 30 m (~670 x 670 cells). Path planning on multi-million-cell grids gets memory-heavy.
- Edge cases: sensor on cell boundary, grid edges, nodata cells.
- Keep scope honest: a polished core beats an unfinished ambitious version.

## 10. Notes for Claude Code
- Prefer the minimum-visible-altitude formulation over binary viewshed.
- Keep all rasters on one shared grid/CRS; document cell size and CRS in the data prep script.
- Validate viewshed output against `gdal_viewshed` on a test sensor before trusting the JS implementation. DONE 2026-10-18 (`prep/validate_viewshed.py`, GDAL 3.10.3 in Docker, `-om GROUND -cc 0.75`): 4 sites (ridge, valley floor, mid-slope, AOI edge), median difference 0.0 m, 99.2-100% agreement on visible/hidden at 1/50/150/300 m AGL. Residual radial streaks (p99 |diff| 2-36 m) are GDAL's sweep approximation: on the 300 worst cells per site, JS is closer to a 10x denser ray sample in 100% of cases (median error JS 0.6-6 m vs GDAL 31-52 m).
- Use slant range (3D distance incl. altitude difference) in the detection function, not just horizontal distance.
- Implement the path cost as step_length × Σ_i -ln(1 - Pd_i) / (v · T_scan); clamp Pd_i to < 1 (e.g. 0.999) to avoid infinite cost.
- Build order: hand-placed sensors first; greedy optimization only after the core pipeline works.
- Path planning: Dijkstra/A* is the primary method (exact for additive cost). Extensions in section 8b order: flow field -> 3D layers -> smoothing -> PSO comparison. Do not make PSO the main planner.
- Everything here is notional and unclassified; use only public data.
