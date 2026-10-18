"""Clip the 20 x 20 km AOI out of the 40 km DEM and its metrics, for Observable.

AOI (chosen 2026-10-17 on the hillshade): a 667 x 667 cell window of the 30 m
grid, cols 416:1083, rows 382:1049 of dem_missoula_30m.tif.
Bounds (EPSG:32612): x 264630-284640, y 5183580-5203590.

Metrics are clipped from the full-grid npz rather than recomputed on the clip,
so the r = 1.5 km windows are not truncated at the AOI edge.

Outputs (data/aoi/):
- <layer>.f32: raw Float32 little-endian, row-major, north-up, row 0 = north
  edge. Load in JS with js/aoi.js, or directly:
    new Float32Array(await FileAttachment("dem.f32").arrayBuffer())
- meta.json: grid description (bounds, cell size, layer list and ranges)
- dem.tif: the clipped DEM as a GeoTIFF, for gdal_viewshed validation

Usage: python prep/clip_aoi.py
"""
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

COL, ROW, N = 416, 382, 667

root = Path(__file__).resolve().parent.parent
src = root / "data" / "dem_missoula_30m.tif"
out = root / "data" / "aoi"
out.mkdir(exist_ok=True)

win = Window(COL, ROW, N, N)
with rasterio.open(src) as ds:
    dem = ds.read(1, window=win, masked=True)
    transform = ds.window_transform(win)
    bounds = ds.window_bounds(win)
    assert ds.res[0] == ds.res[1], "non-square cells"
    cell = ds.res[0]
    profile = ds.profile | {"width": N, "height": N, "transform": transform}
assert not np.ma.is_masked(dem), "DEM has nodata in the AOI"

with rasterio.open(out / "dem.tif", "w", **profile) as dst:
    dst.write(dem.filled(), 1)

layers = {"dem": dem.filled()}
with np.load(root / "data" / "dem_missoula_30m_metrics.npz") as m:
    layers.update({k: m[k][ROW:ROW + N, COL:COL + N] for k in m.files})

xmin, ymin, xmax, ymax = bounds
meta = {
    "source": src.name,
    "crs": profile["crs"].to_string(),
    "width": N, "height": N, "cell_m": cell,
    "xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax,
    "window_in_source": {"col": COL, "row": ROW},
    "dtype": "float32", "byte_order": "little", "layout": "row-major, row 0 = north",
    "layers": {},
}
for name, a in layers.items():
    sub = np.ascontiguousarray(a, dtype="<f4")
    assert sub.shape == (N, N) and np.isfinite(sub).all(), f"{name}: bad shape or nodata"
    sub.tofile(out / f"{name}.f32")
    meta["layers"][name] = {"file": f"{name}.f32", "min": float(sub.min()), "max": float(sub.max())}
    print(f"{name:>12}: {sub.min():9.2f} .. {sub.max():9.2f}")

(out / "meta.json").write_text(json.dumps(meta, indent=2))
print(f"{len(layers)} layers, {N}x{N} @ {cell:.0f} m, bounds {bounds} -> {out}")
