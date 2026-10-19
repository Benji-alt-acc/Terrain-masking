## Testing the hypothesis

The test asks one question many times: **when a drone takes the safest route, what kind of terrain does that route pass through?**

For each test case, we picked:

- a random sensor layout (10 different layouts),
- a random start and goal inside the area (20 pairs per layout),
- a flight altitude (10, 20, 30, 50, 100, 150 or 300 m above ground).

Between the same start and goal, three routes were planned:

1. **Terrain-aware:** the safest route, using hills and valleys to hide.
2. **Range-only:** the safest route if terrain couldn't block line of sight, so the drone can only stay far from sensors.
3. **Straight line.**

That gives 10 × 20 × 7 = 1,400 cases and 4,200 routes. The key comparison is **terrain-aware vs range-only**: both routes try to avoid sensors, so any difference between them comes from terrain.

### What we measured along each route

Three terrain measures were averaged along every route:

- **TPI / DEV:** is the route *lower* or *higher* than the ground around it? Negative means lower, like a valley, gully or the lee side of a ridge. DEV is the same idea scaled so that rugged and gentle terrain are comparable.
- **Relief:** how much up-and-down there is nearby. High means rugged, low means flat.

Each was measured at three neighbourhood sizes: 150 m (small gullies), 500 m (medium valleys) and 1.5 km (large landforms).

### Reading the effect size

For each terrain measure and each case, we asked: was the terrain-aware route's average value of that measure lower or higher than the range-only route's? The effect size (rank-biserial *r*) sums that up on a scale from −1 to +1:

- **−1:** the terrain-aware route had the lower value in every case.
- **0:** no consistent difference.
- **+1:** the terrain-aware route had the higher value in every case.

For TPI/DEV, an effect size of −0.85 means the ground under the terrain-aware route sat further below its surroundings (more valley-like) almost every time. For relief, a positive effect size means the terrain-aware route passed through more rugged ground. The effect size describes the *terrain* along the routes, not detection; detection is covered in Finding 2.

### Finding 1: safe routes hug low, rugged ground (supported)

At the 150 m scale:

- **TPI/DEV are about −0.75 to −0.89.** Safe routes are almost always lower than their immediate surroundings.
- **Relief is about +0.75.** Safe routes almost always pass through more rugged ground.
- **This holds everywhere:** at every altitude and in every one of the 10 sensor layouts.

To avoid detection, the drone tucks into small dips, gullies and the sheltered sides of ridges. This is the same pattern the "rivers" in the flow field show, now confirmed statistically.

### Finding 2: the benefit shrinks as the drone flies higher (partly supported)

| Altitude | Detection avoided compared with range-only |
|---|---|
| 10 m | 89% |
| 50 m | 74% |
| 100 m | 65% |
| 300 m | 44% |

The *direction* stays the same at every height: routes still prefer low ground, even at 300 m. But the *payoff* is smaller, and routes dip less deeply. A drone at 300 m is above most of the folds that could hide it, which is why the ability to fly low makes drones so hard to detect.

### Finding 3: small folds matter, not big valleys (not supported)

The hypothesis predicted that the useful terrain scale would grow with altitude: small dips hiding low drones, large valleys hiding higher ones. Instead, **the 150 m scale is the strongest at every altitude.**

At the 1.5 km scale the sign even flips: safe routes are *higher* than their large-scale surroundings. The broad Missoula valley floor is low but flat and wide open, so many sensors can see across it. The safe routes run through the hills around it instead, threading the small gullies within that higher, broken terrain. "Valleys" in this result means **small side drainages in the hills, not the main valley.**

### In one sentence

The safest routes consistently use small-scale low ground (gullies and lee slopes inside rugged hills, not the open main valley), and that advantage is largest for the lowest-flying drones.
