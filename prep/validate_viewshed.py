"""Compare js/viewshed.js against gdal_viewshed -om GROUND on a few test sensors.

Both compute the minimum target height above ground for line of sight from a
sensor at mast height H. Settings matched: max distance 6 km, curvature with
refraction k = 4/3 (GDAL -cc = 1/k = 0.75), target on the cell centre.
Sensors sit on cell centres so both tools use the same observer elevation.

Needs Docker (image ghcr.io/osgeo/gdal) and Node.
Usage: python prep/validate_viewshed.py
Writes output/validation/ (rasters, viewshed_validation.png) and prints stats.
"""
import subprocess
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import rasterio

IMAGE = "ghcr.io/osgeo/gdal:ubuntu-small-3.10.3"
HEIGHT, MAX_RANGE, K = 10, 6000, 4 / 3
SITES = {  # notional test sensors (UTM 12N, cell centres)
    "ridge": (276705, 5192985),
    "valley floor": (268605, 5194065),
    "mid-slope": (277455, 5190615),
    "near AOI edge": (281805, 5202255),
}

root = Path(__file__).resolve().parent.parent
aoi = root / "data" / "aoi"
out = root / "output" / "validation"
out.mkdir(parents=True, exist_ok=True)
with rasterio.open(aoi / "dem.tif") as ds:
    shape, transform = ds.shape, ds.transform


def run_gdal(name, x, y):
    dst = out / f"gdal_{name}.tif"
    subprocess.run(["docker", "run", "--rm", "-v", f"{root}:/w", IMAGE, "gdal_viewshed", "--quiet",
                    "-ox", str(x), "-oy", str(y), "-oz", str(HEIGHT), "-tz", "0", "-md", str(MAX_RANGE),
                    "-cc", str(1 / K), "-om", "GROUND", "-a_nodata", "-9999",
                    "/w/data/aoi/dem.tif", f"/w/output/validation/{dst.name}"], check=True)
    # GDAL crops its output to the max-distance box; paste it back onto the AOI grid.
    full = np.full(shape, np.nan)
    with rasterio.open(dst) as ds:
        a = ds.read(1, masked=True).astype(np.float64).filled(np.nan)
        c0 = round((ds.transform.c - transform.c) / transform.a)
        r0 = round((ds.transform.f - transform.f) / transform.e)
    full[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = a
    return full


def run_js(name, x, y):
    dst = out / f"js_{name}.f32"
    subprocess.run(["node", str(root / "prep" / "run_viewshed.mjs"), str(aoi), str(dst),
                    str(x), str(y), str(HEIGHT), str(MAX_RANGE)], check=True)
    return np.fromfile(dst, "<f4").reshape(shape).astype(np.float64)


fig, axes = plt.subplots(len(SITES), 4, figsize=(17, 4.2 * len(SITES)), constrained_layout=True)
for row, (name, (x, y)) in zip(axes, SITES.items()):
    slug = name.replace(" ", "_")
    g, j = run_gdal(slug, x, y), run_js(slug, x, y)
    both = np.isfinite(g) & np.isfinite(j)
    d = (j - g)[both]
    vis_j, vis_g = j[both] < 1, g[both] < 1  # visible at ground (1 m tolerance)
    agree = {A: np.mean((j[both] < A) == (g[both] < A)) for A in (1, 50, 150, 300)}
    print(f"{name:>14}: {both.sum()} cells | JS-GDAL diff median {np.median(d):+.2f} m, "
          f"|diff| p50/p90/p99 {np.percentile(abs(d), 50):.1f}/{np.percentile(abs(d), 90):.1f}/{np.percentile(abs(d), 99):.1f} m | "
          f"visible@ground JS {vis_j.mean():.0%} GDAL {vis_g.mean():.0%} | "
          "visibility agreement " + ", ".join(f"{A} m {v:.1%}" for A, v in agree.items()))

    vmax = 300
    for ax, a, title in ((row[0], j, "JS"), (row[1], g, "GDAL")):
        im = ax.imshow(a, cmap="magma_r", vmin=0, vmax=vmax)
        ax.set_title(f"{name}: {title} min visible AGL (m)")
    fig.colorbar(im, ax=row[:2], shrink=0.8)
    diff = np.where(both, j - g, np.nan)
    im = row[2].imshow(diff, cmap="RdBu_r", vmin=-30, vmax=30)
    row[2].set_title("JS - GDAL (m)")
    fig.colorbar(im, ax=row[2], shrink=0.8)
    row[3].hist(np.clip(d, -60, 60), bins=121, log=True, color="0.3")
    row[3].set_title("JS - GDAL, clipped to ±60 m (log count)")
    for ax in row[:3]:
        ax.plot((x - 264630) / 30 - 0.5, (5203590 - y) / 30 - 0.5, "o", ms=6, mfc="#2ca02c", mec="white")
        ax.set_xticks([]); ax.set_yticks([])

fig.savefig(out / "viewshed_validation.png", dpi=80)
print("figure:", out / "viewshed_validation.png")
