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

## 2. Open decisions (fill in)
- [ ] Deadline / required scope: ____
- [ ] Does the assignment allow non-JS prep steps? (assumed yes)
- [x] Area of interest: Missoula, MT. 40 x 40 km window fetched at 30 m (`prep/fetch_dem.py` -> `data/dem_missoula_30m.tif`, EPSG:32612). Terrain variety checked (`prep/terrain_metrics.py`): good mix of flat valley floor, canyons, and dissected ridges. Still to choose: final 20 km sub-AOI.
- [ ] Static vs. interactive final product: ____
- [ ] Audience: class only, or also portfolio/employers: ____

## 2b. Decisions made
- Build order: hand-placed sensors first (get the core pipeline working), then add greedy-optimized placement.
- Detection model: probabilistic, with detection probability decaying with slant range (logistic, tunable R50 and steepness k). R50/k are ILLUSTRATIVE parameters, not real sensor specs. Show sensitivity to them.
- Path cost is survival-based: cost per cell = -ln(1 - P_detect(c)), so summed path cost = -ln(probability of reaching goal undetected). Additive, so Dijkstra/A* stays exact. Headline metric = probability of surviving undetected.
- Sensors assumed independent when combining: P(c) = 1 - prod(1 - P_i(c)). State this assumption.
- Attacker is assumed to know all sensor positions and the model exactly (pessimistic for defender). State this.
- Missoula County (or nearby) is acceptable as a NOTIONAL defended valley; not a realistic adversary scenario. Say so in the write-up.

## 3. Data
- Elevation: USGS 3DEP bare-earth DEM (~10 m national; 1 m lidar where available). For areas outside the US: Copernicus GLO-30.
- Optional context layers: OpenStreetMap roads/power lines (candidate sensor siting constraints), Sentinel-2 or NAIP imagery (base map), land cover (NLCD) for a vegetation/clutter penalty.
- Prep (Python, rasterio/GDAL): clip to AOI, reproject to a metric CRS (Montana State Plane or UTM 12N), resample to ~30 m for interactivity, export a small Float32 binary or GeoTIFF (target < ~20 MB for Observable attachments).
- Do NOT use Web Mercator pixel sizes for slope/LOS math (at ~47°N distances are stretched ~1.46x).

## 4. Processing pipeline (all rasters on the same grid)
1. DEM -> hillshade + slope (+ roughness)
2. Per sensor: **minimum visible altitude (AGL)** raster via radial sweep tracking horizon angle (include earth curvature, sensor height, max range). Cheaper and more useful than a binary viewshed: altitude slider = simple threshold.
3. Per-sensor detection probability at altitude A: P_i(c) = 0 if masked (minAlt_i(c) > A), else logistic(slant_range; R50, k), with a hard max-range cutoff
4. Combined detection probability: P(c) = 1 - prod_i(1 - P_i(c)). Visualize as a continuous field (soft-edged dead zones)
5. Cost surface: -ln(1 - P(c)) per cell (+ optional small slope/roughness term). Keep the survival term separate from terrain terms so the survival metric stays interpretable
6. Least-exposure path: A*/Dijkstra (binary heap) from start to goal
7. Comparison: straight-line vs. least-exposure path (length, P(survive undetected)); survival-probability profile along each path

## 5. Sensor placement (see discussion in chat)
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
- Validate viewshed output against `gdal_viewshed` on a test sensor before trusting the JS implementation.
- Use slant range (3D distance incl. altitude difference) in the detection function, not just horizontal distance.
- Implement the path cost as -ln(1 - P), clamp P to < 1 (e.g. 0.999) to avoid infinite cost.
- Build order: hand-placed sensors first; greedy optimization only after the core pipeline works.
- Path planning: Dijkstra/A* is the primary method (exact for additive cost). Extensions in section 8b order: flow field -> 3D layers -> smoothing -> PSO comparison. Do not make PSO the main planner.
- Everything here is notional and unclassified; use only public data.
