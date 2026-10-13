"""Terrain metrics for the hypothesis (see plan §1b), on the DEM's own grid.

- hillshade, slope (deg)
- local relief(r): max - min elevation in a (2r+1)-cell SQUARE window (separable, fast)
- TPI(r): elev - mean elev in a CIRCULAR window of radius r (FFT convolution)
- DEV(r): TPI(r) / std(elev) in the same circular window

Edges: windows are truncated at the grid edge (mean/std over in-grid cells only).

Usage: python prep/terrain_metrics.py data/dem_missoula_30m.tif
Writes data/<stem>_metrics.npz and output/<stem>_overview.png
"""
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import rasterio
from scipy.ndimage import maximum_filter, minimum_filter
from scipy.signal import fftconvolve

RADII_M = (150, 500, 1500)

src = Path(sys.argv[1] if len(sys.argv) > 1 else "data/dem_missoula_30m.tif")
root = Path(__file__).resolve().parent.parent
with rasterio.open(src) as ds:
    z = ds.read(1).astype(np.float64)
    cell = ds.res[0]


def disk_mean_std(a, r_cells):
    yy, xx = np.mgrid[-r_cells:r_cells + 1, -r_cells:r_cells + 1]
    k = (xx**2 + yy**2 <= r_cells**2).astype(np.float64)
    cnt = fftconvolve(np.ones_like(a), k, mode="same")
    s1 = fftconvolve(a, k, mode="same") / cnt
    s2 = fftconvolve(a * a, k, mode="same") / cnt
    return s1, np.sqrt(np.maximum(s2 - s1 * s1, 1e-6))


dzdy, dzdx = np.gradient(z, cell)
slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
az, alt = np.radians(315), np.radians(45)
aspect = np.arctan2(-dzdx, dzdy)
hill = np.sin(alt) * np.cos(np.radians(slope)) + np.cos(alt) * np.sin(np.radians(slope)) * np.cos(az - aspect)

out = {"slope": slope, "hillshade": hill}
for r in RADII_M:
    rc = max(1, round(r / cell))
    out[f"relief_{r}"] = maximum_filter(z, size=2 * rc + 1) - minimum_filter(z, size=2 * rc + 1)
    mean, std = disk_mean_std(z, rc)
    out[f"tpi_{r}"] = z - mean
    out[f"dev_{r}"] = (z - mean) / std

np.savez_compressed(root / "data" / f"{src.stem}_metrics.npz", **{k: v.astype(np.float32) for k, v in out.items()})

# --- summary stats -------------------------------------------------------
print(f"{src.name}: {z.shape}, {cell} m, elev {z.min():.0f}-{z.max():.0f} m")
pct = lambda a: np.percentile(a, [5, 50, 95])
print(f"slope deg      p5/p50/p95 = {pct(slope).round(1)}; flat(<5deg) {np.mean(slope < 5):.0%}, steep(>25deg) {np.mean(slope > 25):.0%}")
for r in RADII_M:
    print(f"relief {r:>5} m p5/p50/p95 = {pct(out[f'relief_{r}']).round(0)}")
for r in RADII_M:
    d = out[f"dev_{r}"]
    print(f"DEV {r:>5} m: valley(<-1) {np.mean(d < -1):.0%}, mid {np.mean(abs(d) <= 1):.0%}, ridge(>1) {np.mean(d > 1):.0%}")

# --- overview figure -----------------------------------------------------
extent = None
panels = [("Hillshade + elevation", None), ("Slope (deg)", "slope"), ("Local relief, r=500 m (m)", "relief_500"),
          ("DEV, r=150 m", "dev_150"), ("DEV, r=500 m", "dev_500"), ("DEV, r=1500 m", "dev_1500")]
fig, axes = plt.subplots(2, 3, figsize=(15, 10), constrained_layout=True)
for ax, (title, key) in zip(axes.flat, panels):
    if key is None:
        ax.imshow(z, cmap="gist_earth")
        im = ax.imshow(hill, cmap="gray", alpha=0.45)
        im = ax.images[0]
    elif key.startswith("dev"):
        im = ax.imshow(out[key], cmap="RdBu_r", vmin=-2.5, vmax=2.5)
        ax.imshow(hill, cmap="gray", alpha=0.25)
    else:
        im = ax.imshow(out[key], cmap="viridis", vmax=np.percentile(out[key], 99))
    fig.colorbar(im, ax=ax, shrink=0.75)
    ax.set_title(title)
    ax.set_xticks([]); ax.set_yticks([])
fig.suptitle(f"{src.stem}: {z.shape[1] * cell / 1000:.0f} x {z.shape[0] * cell / 1000:.0f} km, {cell:.0f} m cells "
             "(DEV: blue = lower than surroundings, red = higher)")
(root / "output").mkdir(exist_ok=True)
fig.savefig(root / "output" / f"{src.stem}_overview.png", dpi=110)
print("figure:", root / "output" / f"{src.stem}_overview.png")
