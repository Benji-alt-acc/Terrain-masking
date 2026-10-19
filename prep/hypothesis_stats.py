"""Statistics for the hypothesis batch (plan §1b), from data/batch/routes_*.csv.

For each comparison route (range-only control, straight line), terrain metric and
altitude: difference d = terrain-aware route value - comparison route value, one per
(layout, pair).
- Paired Wilcoxon signed-rank test on d (zero differences dropped), with the
  matched-pairs rank-biserial correlation r = (W+ - W-) / (W+ + W-) as effect size
  (-1..1; negative = terrain-aware routes have lower values). Holm correction
  within each comparison.
- Conservative check: pairs in a layout share sensors, so also test the per-layout
  median differences (n = number of layouts) and report how many layouts agree in sign
  with the overall median.
H1 expects lower TPI/DEV (valleys, lee sides) and higher local relief on the
terrain-aware route, with the best-predicting radius growing with altitude.

Usage: python prep/hypothesis_stats.py
Writes data/batch/hypothesis_effects.csv, data/batch/exposure_summary.csv,
output/hypothesis_effects.png, and prints a summary.
"""
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import rankdata, wilcoxon

root = Path(__file__).resolve().parent.parent
batch = root / "data" / "batch"
df = pd.concat([pd.read_csv(f) for f in sorted(batch.glob("routes_*.csv"))], ignore_index=True)
METRICS = ["slope"] + [f"{m}_{r}" for r in (150, 500, 1500) for m in ("relief", "tpi", "dev")]
key = ["layout", "pair", "altitude"]
wide = df.pivot_table(index=key, columns="route", values=METRICS + ["e_det", "length_m", "frac_buffer"])
n_layouts = df.layout.nunique()
print(f"{len(df)} routes: {n_layouts} layouts x {df.groupby('layout').pair.nunique().iloc[0]} pairs x {df.altitude.nunique()} altitudes")


def rank_biserial(d):
    d = d[d != 0]
    if len(d) == 0:
        return np.nan
    rk = rankdata(np.abs(d))
    return (rk[d > 0].sum() - rk[d < 0].sum()) / rk.sum()


def holm(p):
    p = np.asarray(p, float)
    out = np.full_like(p, np.nan)
    ok = ~np.isnan(p)
    order = np.argsort(p[ok])
    m = ok.sum()
    adj = np.maximum.accumulate((m - np.arange(m)) * p[ok][order])
    out[np.flatnonzero(ok)[order]] = np.minimum(adj, 1)
    return out


rows = []
for comp in ("range", "straight"):
    for metric in METRICS:
        for alt, g in wide.groupby(level="altitude"):
            d = (g[(metric, "terrain")] - g[(metric, comp)]).to_numpy()
            nz = d[d != 0]
            p = wilcoxon(nz).pvalue if len(nz) >= 10 else np.nan
            per_layout = (g[(metric, "terrain")] - g[(metric, comp)]).groupby(level="layout").median()
            pl = wilcoxon(per_layout[per_layout != 0]).pvalue if (per_layout != 0).sum() >= 6 else np.nan
            sign = np.sign(np.median(d))
            rows.append({"comparison": comp, "metric": metric.split("_")[0],
                         "radius": int(metric.split("_")[1]) if "_" in metric else np.nan,
                         "altitude": alt, "n": len(d), "n_nonzero": len(nz), "median_diff": np.median(d),
                         "rank_biserial": rank_biserial(d), "p": p, "p_layouts": pl,
                         "layouts_same_sign": int((np.sign(per_layout) == sign).sum()) if sign != 0 else 0})
eff = pd.DataFrame(rows)
for comp in ("range", "straight"):
    m = eff.comparison == comp
    eff.loc[m, "p_holm"] = holm(eff.loc[m, "p"])
eff.to_csv(batch / "hypothesis_effects.csv", index=False)

# Exposure outcome: how much terrain-aware routing saves.
ed = wide["e_det"]
expo = pd.DataFrame({
    "saving_vs_range": 1 - ed["terrain"] / ed["range"],
    "saving_vs_straight": 1 - ed["terrain"] / ed["straight"],
    "detour_terrain": wide["length_m"]["terrain"] / wide["length_m"]["straight"],
    "frac_buffer_terrain": wide["frac_buffer"]["terrain"],
}).groupby(level="altitude").median()
expo.to_csv(batch / "exposure_summary.csv")

# ---- printed summary ---------------------------------------------------------
pd.set_option("display.width", 200)
print("\nExposure (medians across layouts x pairs):\n", expo.round(3))
for comp in ("range", "straight"):
    t = eff[(eff.comparison == comp) & (eff.metric != "slope")]
    print(f"\nRank-biserial r, terrain-aware vs {comp} (rows metric_radius, cols altitude; * = Holm p < 0.05):")
    piv = t.assign(cell=lambda x: x.rank_biserial.round(2).astype(str) + np.where(x.p_holm < 0.05, "*", " "),
                   name=lambda x: x.metric + "_" + x.radius.astype(int).astype(str))
    print(piv.pivot(index="name", columns="altitude", values="cell"))
    for metric in ("dev", "tpi", "relief"):
        tm = t[t.metric == metric]
        best = tm.loc[tm.rank_biserial.abs().groupby(tm.altitude).idxmax()].sort_values("altitude")
        print(f"  strongest radius for {metric} by altitude: " + ", ".join(f"{a} m -> {int(r)} m" for a, r in zip(best.altitude, best.radius)))
s = eff[eff.metric == "slope"][["comparison", "altitude", "rank_biserial", "p_holm"]]
print("\nSlope:\n", s.pivot(index="altitude", columns="comparison", values="rank_biserial").round(2))
print(f"\nConservative layout-level check: tests with p_layouts < 0.05: "
      f"{(eff.p_layouts < 0.05).sum()} / {eff.p_layouts.notna().sum()}; "
      f"min layouts agreeing in sign among Holm-significant tests: {eff[eff.p_holm < 0.05].layouts_same_sign.min()} / {n_layouts}")

# ---- figure ------------------------------------------------------------------
alts = sorted(eff.altitude.unique())
colors = plt.cm.viridis(np.linspace(0.05, 0.9, len(alts)))
fig, axes = plt.subplots(2, 3, figsize=(14, 7.5), sharex=True, sharey=True, constrained_layout=True)
for row, comp in zip(axes, ("range", "straight")):
    for ax, metric in zip(row, ("dev", "tpi", "relief")):
        for a, c in zip(alts, colors):
            t = eff[(eff.comparison == comp) & (eff.metric == metric) & (eff.altitude == a)].sort_values("radius")
            ax.plot(t.radius, t.rank_biserial, "-o", color=c, label=f"{a} m")
            sig = t.p_holm < 0.05
            ax.scatter(t.radius[~sig], t.rank_biserial[~sig], s=60, facecolor="white", edgecolor=c, zorder=3)
        ax.axhline(0, color="0.5", lw=0.8)
        ax.set_xscale("log"); ax.set_xticks([150, 500, 1500]); ax.set_xticklabels(["150", "500", "1500"])
        ax.set_title(f"{metric.upper()}: terrain-aware vs {'range-only' if comp == 'range' else 'straight line'}")
        ax.set_ylim(-1, 1)
for ax in axes[-1]:
    ax.set_xlabel("Radius r (m)")
for ax in axes[:, 0]:
    ax.set_ylabel("Effect size (rank-biserial r)")
axes[0, -1].legend(title="Altitude AGL", fontsize=8)
fig.suptitle("Terrain along least-exposure routes (open markers: not significant after Holm)")
fig.savefig(root / "output" / "hypothesis_effects.png", dpi=100)
print("figure:", root / "output" / "hypothesis_effects.png")
