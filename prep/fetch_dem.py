"""Fetch a USGS 3DEP DEM for an area of interest, reprojected to UTM.

Source: USGS 3DEP 1/3 arc-second (~10 m) bare-earth DEM, via the 3DEP
ImageServer exportImage endpoint (server-side reprojection + resampling).

Grid: square window of HALF_WIDTH_M around (LAT, LON), cell size CELL_M,
CRS = WGS 84 / UTM zone 12N (EPSG:32612). Output: Float32 GeoTIFF.

Usage: python prep/fetch_dem.py [name lat lon half_width_m cell_m]
"""
import sys
from pathlib import Path

import requests
from pyproj import Transformer

ENDPOINT = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
EPSG = 32612

NAME, LAT, LON, HALF_WIDTH_M, CELL_M = "missoula", 46.87, -113.99, 20_000, 30
if len(sys.argv) == 6:
    NAME, LAT, LON, HALF_WIDTH_M, CELL_M = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])

out = Path(__file__).resolve().parent.parent / "data" / f"dem_{NAME}_{int(CELL_M)}m.tif"
out.parent.mkdir(exist_ok=True)

x, y = Transformer.from_crs(4326, EPSG, always_xy=True).transform(LON, LAT)
# Snap the window to the cell grid so later rasters align exactly.
xmin = round((x - HALF_WIDTH_M) / CELL_M) * CELL_M
ymin = round((y - HALF_WIDTH_M) / CELL_M) * CELL_M
n = int(2 * HALF_WIDTH_M / CELL_M)
xmax, ymax = xmin + n * CELL_M, ymin + n * CELL_M

params = {
    "bbox": f"{xmin},{ymin},{xmax},{ymax}",
    "bboxSR": EPSG,
    "imageSR": EPSG,
    "size": f"{n},{n}",
    "format": "tiff",
    "pixelType": "F32",
    "noData": -9999,
    "interpolation": "RSP_BilinearInterpolation",
    "f": "image",
}
print(f"Requesting {n}x{n} @ {CELL_M} m, bbox {params['bbox']} (EPSG:{EPSG})")
r = requests.get(ENDPOINT, params=params, timeout=300)
r.raise_for_status()
if not r.content.startswith((b"II*", b"MM\x00*")):
    sys.exit(f"Not a TIFF response:\n{r.text[:500]}")
out.write_bytes(r.content)
print(f"Wrote {out} ({len(r.content) / 1e6:.1f} MB)")
