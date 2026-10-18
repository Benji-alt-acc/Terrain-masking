// Load the AOI rasters written by prep/clip_aoi.py (data/aoi/).
//
// The loader takes a `file(name)` function returning something with
// .json() and .arrayBuffer(), so the same code works with Observable
// FileAttachment, fetch, or Node. Observable only finds attachments named by
// string literals, so list the files you need in an object:
//   const files = {"meta.json": FileAttachment("meta.json"), "dem.f32": FileAttachment("dem.f32")}
//   const aoi = await loadAOI((f) => files[f], ["dem"])
// Browser: await loadAOI((f) => fetch(`data/aoi/${f}`))
//
// Grid: row-major, row 0 = north edge; index = row * width + col.
// Cell (col, row) covers x in [xmin + col*cell, +cell), y in (ymax - (row+1)*cell, ymax - row*cell].

export async function loadAOI(file, names) {
  const meta = await file("meta.json").json();
  names ??= Object.keys(meta.layers);
  const n = meta.width * meta.height;
  const layers = {};
  await Promise.all(names.map(async (name) => {
    const info = meta.layers[name];
    if (!info) throw new Error(`unknown layer ${name}`);
    const a = new Float32Array(await file(info.file).arrayBuffer());
    if (a.length !== n) throw new Error(`${name}: ${a.length} values, expected ${n}`);
    layers[name] = a;
  }));
  return {meta, layers, ...gridHelpers(meta)};
}

export function gridHelpers({width, height, cell_m: cell, xmin, ymax}) {
  return {
    width, height, cell,
    index: (col, row) => row * width + col,
    // Cell centre in projected metres (EPSG:32612).
    toXY: (col, row) => [xmin + (col + 0.5) * cell, ymax - (row + 0.5) * cell],
    // Containing cell for a projected point; null if outside the grid.
    toCell(x, y) {
      const col = Math.floor((x - xmin) / cell), row = Math.floor((ymax - y) / cell);
      return col >= 0 && col < width && row >= 0 && row < height ? [col, row] : null;
    }
  };
}
