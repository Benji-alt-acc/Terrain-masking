"""Fetch the buffered routing domain at 10 m, for the low-altitude DEM-resolution check.

Same bounds as prep/clip_domain.py (x 259620-289650, y 5178570-5208600,
EPSG:32612), so the 10 m grid nests exactly inside the 30 m one
(each 30 m cell = a 3 x 3 block of 10 m cells). Same source and server-side
bilinear resampling as prep/fetch_dem.py.

Outputs (data/domain10/), same layout as data/domain/:
- domain_dem_10m.tif (GeoTIFF as served), domain_dem.f32, domain_meta.json

Usage: python prep/fetch_domain_10m.py
"""
import json
import time
from pathlib import Path

import numpy as np
import rasterio
import requests

ENDPOINT = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
EPSG = 32612
XMIN, YMIN, SIZE_M, CELL = 259620, 5178570, 30030, 10
AOI_OFFSET_M, AOI_SIZE_M = 5010, 20010  # AOI position inside the domain (prep/clip_domain.py)

root = Path(__file__).resolve().parent.parent
out = root / "data" / "domain10"
out.mkdir(parents=True, exist_ok=True)
tif = out / "domain_dem_10m.tif"

n = SIZE_M // CELL
TILES = 3  # the server rejects a single 3003 x 3003 request; fetch 3 x 3 tiles of 1001 x 1001
t = n // TILES
dem = np.empty((n, n), dtype="<f4")
for j in range(TILES):          # rows, north to south
    for i in range(TILES):
        x0, y1 = XMIN + i * t * CELL, YMIN + SIZE_M - j * t * CELL
        params = {
            "bbox": f"{x0},{y1 - t * CELL},{x0 + t * CELL},{y1}", "bboxSR": EPSG, "imageSR": EPSG,
            "size": f"{t},{t}", "format": "tiff", "pixelType": "F32", "noData": -9999,
            "interpolation": "RSP_BilinearInterpolation", "f": "image",
        }
        cache = out / f"tile_{j}{i}.tif"  # cached so a rerun resumes after a server error
        if not cache.exists():
            for attempt in range(4):
                print(f"Requesting tile {j},{i} ({t}x{t} @ {CELL} m), attempt {attempt + 1}")
                r = requests.get(ENDPOINT, params=params, timeout=600)
                if r.ok and r.content.startswith((b"II*", b"MM\x00*")):
                    cache.write_bytes(r.content)
                    break
                print(f"  failed: HTTP {r.status_code}")
                time.sleep(10 * (attempt + 1))
            else:
                raise SystemExit(f"tile {j},{i} failed; rerun to retry")
        with rasterio.open(cache) as ds:
            assert ds.shape == (t, t) and ds.crs.to_epsg() == EPSG, (ds.shape, ds.crs)
            assert abs(ds.transform.c - x0) < 1e-6 and abs(ds.transform.f - y1) < 1e-6, ds.transform
            tile = ds.read(1, masked=True)
        assert not np.ma.is_masked(tile), f"nodata in tile {j},{i}"
        dem[j * t:(j + 1) * t, i * t:(i + 1) * t] = tile.filled()
dem.tofile(out / "domain_dem.f32")
profile = {"driver": "GTiff", "dtype": "float32", "width": n, "height": n, "count": 1, "crs": f"EPSG:{EPSG}",
           "transform": rasterio.transform.from_origin(XMIN, YMIN + SIZE_M, CELL, CELL), "compress": "deflate"}
with rasterio.open(tif, "w", **profile) as dst:
    dst.write(dem, 1)

a = AOI_OFFSET_M // CELL
meta = {
    "source": "USGS 3DEP ImageServer, 10 m bilinear", "crs": f"EPSG:{EPSG}",
    "width": n, "height": n, "cell_m": CELL,
    "xmin": XMIN, "ymin": YMIN, "xmax": XMIN + SIZE_M, "ymax": YMIN + SIZE_M,
    "aoi": {"col": a, "row": a, "size": AOI_SIZE_M // CELL,
            "xmin": XMIN + AOI_OFFSET_M, "ymax": YMIN + SIZE_M - AOI_OFFSET_M,
            "xmax": XMIN + AOI_OFFSET_M + AOI_SIZE_M, "ymin": YMIN + SIZE_M - AOI_OFFSET_M - AOI_SIZE_M},
    "dtype": "float32", "byte_order": "little", "layout": "row-major, row 0 = north",
    "layers": {"dem": {"file": "domain_dem.f32", "min": float(dem.min()), "max": float(dem.max())}},
}
(out / "domain_meta.json").write_text(json.dumps(meta, indent=2))

# Consistency with the 30 m domain: mean of each 3 x 3 block vs the 30 m cell.
z30 = np.fromfile(root / "data" / "domain" / "domain_dem.f32", "<f4").reshape(n // 3, n // 3)
block = dem.reshape(n // 3, 3, n // 3, 3).mean(axis=(1, 3))
d = block - z30
print(f"{n}x{n} @ {CELL} m, elev {dem.min():.0f}-{dem.max():.0f} m -> {out}")
print(f"3x3 block mean - 30 m cell: median {np.median(d):+.2f} m, |diff| p95 {np.percentile(abs(d), 95):.2f} m")
