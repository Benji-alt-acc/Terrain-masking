"""Clip the buffered routing domain (iteration 2): the AOI plus 5 km on every side.

Domain: 1001 x 1001 cells of the 30 m grid, cols 249:1250, rows 215:1216 of
dem_missoula_30m.tif (30 x 30 km). Bounds (EPSG:32612): x 259620-289650,
y 5178570-5208600. The AOI (data/aoi/) sits at cols/rows 167:834 inside it.

Sensors and routes may use the buffer, so the AOI edge stops being a special
place (no unmodelled "outside" next to it). Analysis stays inside the AOI.

Outputs (data/domain/), same raw Float32 layout as prep/clip_aoi.py, with a
domain_ prefix so they don't clash with the AOI attachments in Observable:
- domain_dem.f32, domain_hillshade.f32
- domain_meta.json (grid, plus the AOI window inside the domain)

Usage: python prep/clip_domain.py
"""
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

AOI_COL, AOI_ROW, AOI_N = 416, 382, 667  # must match prep/clip_aoi.py
BUFFER = 167                              # cells (5.01 km)
COL, ROW, N = AOI_COL - BUFFER, AOI_ROW - BUFFER, AOI_N + 2 * BUFFER

root = Path(__file__).resolve().parent.parent
src = root / "data" / "dem_missoula_30m.tif"
out = root / "data" / "domain"
out.mkdir(exist_ok=True)

win = Window(COL, ROW, N, N)
with rasterio.open(src) as ds:
    assert COL >= 0 and ROW >= 0 and COL + N <= ds.width and ROW + N <= ds.height, "domain exceeds source DEM"
    dem = ds.read(1, window=win, masked=True)
    bounds = ds.window_bounds(win)
    cell = ds.res[0]
    crs = ds.crs.to_string()
assert not np.ma.is_masked(dem), "DEM has nodata in the domain"

layers = {"dem": dem.filled()}
with np.load(root / "data" / "dem_missoula_30m_metrics.npz") as m:
    layers["hillshade"] = m["hillshade"][ROW:ROW + N, COL:COL + N]

xmin, ymin, xmax, ymax = bounds
meta = {
    "source": src.name,
    "crs": crs,
    "width": N, "height": N, "cell_m": cell,
    "xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax,
    "window_in_source": {"col": COL, "row": ROW},
    "aoi": {"col": BUFFER, "row": BUFFER, "size": AOI_N,
            "xmin": xmin + BUFFER * cell, "ymax": ymax - BUFFER * cell,
            "xmax": xmin + (BUFFER + AOI_N) * cell, "ymin": ymax - (BUFFER + AOI_N) * cell},
    "dtype": "float32", "byte_order": "little", "layout": "row-major, row 0 = north",
    "layers": {},
}
for name, a in layers.items():
    sub = np.ascontiguousarray(a, dtype="<f4")
    assert sub.shape == (N, N) and np.isfinite(sub).all(), f"{name}: bad shape or nodata"
    fname = f"domain_{name}.f32"
    sub.tofile(out / fname)
    meta["layers"][name] = {"file": fname, "min": float(sub.min()), "max": float(sub.max())}
    print(f"{name:>10}: {sub.min():9.2f} .. {sub.max():9.2f}")

(out / "domain_meta.json").write_text(json.dumps(meta, indent=2))
print(f"{N}x{N} @ {cell:.0f} m, bounds {bounds}, AOI at {BUFFER}:{BUFFER + AOI_N} -> {out}")
