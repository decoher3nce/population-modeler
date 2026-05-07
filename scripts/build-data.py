#!/usr/bin/env python3
"""
Process raw OWID/UN WPP CSVs into compact JSON for the client.

Outputs to public/data/:
  - entities.json       List of {id, name, kind, group}, plus default "featured" set.
  - timeseries.json     Per-entity historical+projected medium-variant indicators.
  - age-2023.json       2023 5-year age structure (the projection seed).
  - demographic-tables.json  Standard ASFR distribution + survival ratios by e0.
"""

from __future__ import annotations
import csv
import json
import math
import os
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw-data"
OUT = ROOT / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

AGE_GROUPS_5 = [
    "0_4", "5_9", "10_14", "15_19", "20_24", "25_29", "30_34",
    "35_39", "40_44", "45_49", "50_54", "55_59", "60_64",
    "65_69", "70_74", "75_79", "80_84", "85_89", "90_94", "95_99", "100plus",
]

REGIONS = {
    "OWID_WRL": "World",
    "Africa": "Africa",
    "Asia": "Asia",
    "Europe": "Europe",
    "Northern America": "Northern America",
    "Latin America and the Caribbean (UN)": "Latin America & Caribbean",
    "Oceania": "Oceania",
    "Sub-Saharan Africa (UN)": "Sub-Saharan Africa",
    "Eastern Asia (UN)": "Eastern Asia",
    "Southern Asia (UN)": "Southern Asia",
    "South-Eastern Asia (UN)": "South-Eastern Asia",
    "Western Asia (UN)": "Western Asia",
    "Western Europe (UN)": "Western Europe",
    "Eastern Europe (UN)": "Eastern Europe",
    "Northern Europe (UN)": "Northern Europe",
    "Southern Europe (UN)": "Southern Europe",
    "European Union (27)": "European Union",
    "High-income countries": "High-income countries",
    "Low-income countries": "Low-income countries",
    "Upper-middle-income countries": "Upper-middle-income",
    "Lower-middle-income countries": "Lower-middle-income",
}


def read_csv(path: Path):
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield row


def parse_float(x):
    if x is None or x == "" or x == "NA":
        return None
    try:
        return float(x)
    except ValueError:
        return None


def coalesce(a, b):
    return a if a is not None else b


def load_indicator(path: Path, *cols):
    """Return dict[entity] = {year: value} taking the first non-null col per row."""
    out = defaultdict(dict)
    code_for = {}
    for r in read_csv(path):
        ent = r["entity"]
        code_for[ent] = r["code"]
        try:
            year = int(r["year"])
        except (TypeError, ValueError):
            continue
        val = None
        for c in cols:
            v = parse_float(r.get(c))
            if v is not None:
                val = v
                break
        if val is not None:
            out[ent][year] = val
    return out, code_for


def load_age_structure(path: Path):
    """Return dict[entity][year] = list of 21 5-year age group counts."""
    out = defaultdict(dict)
    code_for = {}
    cols = [f"population__sex_all__age_{g}__variant_estimates" for g in AGE_GROUPS_5]
    for r in read_csv(path):
        ent = r["entity"]
        code_for[ent] = r["code"]
        try:
            year = int(r["year"])
        except (TypeError, ValueError):
            continue
        vals = []
        ok = True
        for c in cols:
            v = parse_float(r.get(c))
            if v is None:
                ok = False
                break
            vals.append(v)
        if ok:
            out[ent][year] = vals
    return out, code_for


def round_to(v, ndigits=2):
    if v is None:
        return None
    return round(v, ndigits)


def main():
    print("Loading source CSVs...")
    dep_total, codes_a = load_indicator(
        RAW / "dependency-ratio.csv",
        "dependency_ratio__sex_all__age_total__variant_medium__projected",
        "dependency_ratio__sex_all__age_total__variant_estimates",
    )
    dep_old, _ = load_indicator(
        RAW / "dep-ratio-old.csv",
        "dependency_ratio__sex_all__age_old__variant_estimates",
    )
    dep_young, _ = load_indicator(
        RAW / "dep-ratio-young.csv",
        "dependency_ratio__sex_all__age_youth__variant_estimates",
    )

    tfr_proj, _ = load_indicator(
        RAW / "tfr-projections.csv",
        "fertility_rate__sex_all__age_all__variant_medium__projected",
        "fertility_rate__sex_all__age_all__variant_estimates",
    )
    e0_hist, _ = load_indicator(RAW / "life-expectancy.csv", "life_expectancy_0")
    pop_total, _ = load_indicator(
        RAW / "population-total.csv",
        "population__sex_all__age_all__variant_medium__projected",
        "population__sex_all__age_all__variant_estimates",
    )
    pop_0_14, _ = load_indicator(
        RAW / "pop-broad-age.csv",
        "population__sex_all__age_0_14__variant_medium__projected",
        "population__sex_all__age_0_14__variant_estimates",
    )
    pop_15_64, _ = load_indicator(
        RAW / "pop-broad-age.csv",
        "population__sex_all__age_15_64__variant_medium__projected",
        "population__sex_all__age_15_64__variant_estimates",
    )
    pop_65, _ = load_indicator(
        RAW / "pop-broad-age.csv",
        "population__sex_all__age_65plus__variant_medium__projected",
        "population__sex_all__age_65plus__variant_estimates",
    )
    growth, _ = load_indicator(
        RAW / "growth-vs-natural.csv",
        "growth_rate__sex_all__age_all__variant_estimates",
    )
    natural, _ = load_indicator(
        RAW / "growth-vs-natural.csv",
        "natural_change_rate__sex_all__age_all__variant_estimates",
    )
    print("Loading 5-year age structure (this is the big one)...")
    age5, codes_age = load_age_structure(RAW / "pop-5yr.csv")

    # Master entity set: union of all loaded indicators, but keep only those with both
    # the age structure (for projection seeding) AND the dep-ratio projections.
    entities_all = set(codes_age.keys()) & set(codes_a.keys())
    entities_all &= set(tfr_proj.keys()) & set(pop_total.keys())
    print(f"Entities with full data: {len(entities_all)}")

    # Build entity catalog
    catalog = []
    for ent in sorted(entities_all):
        code = codes_a.get(ent) or codes_age.get(ent) or ""
        kind = "country"
        if ent in REGIONS:
            kind = "region"
        elif code.startswith("OWID_") or "(" in ent or any(
            tag in ent for tag in (
                "income", "World", "Europe", "Asia", "Africa", "America",
                "Oceania", "Caribbean", "Union",
            )
        ):
            # heuristic: aggregates frequently lack a 3-letter ISO code
            if not code or len(code) != 3 or code.startswith("OWID_"):
                kind = "region"
        catalog.append({
            "id": ent,
            "name": ent.replace(" (UN)", "").replace("(UN)", "").strip(),
            "code": code,
            "kind": kind,
        })

    catalog.sort(key=lambda x: (0 if x["kind"] == "region" else 1, x["name"]))

    # Featured set: world, regions, then top countries by 2023 population
    featured = []
    pop_2023 = []
    for ent in entities_all:
        ts = pop_total.get(ent, {})
        p = ts.get(2023) or ts.get(2024)
        if p is not None:
            pop_2023.append((ent, p))
    pop_2023.sort(key=lambda x: -x[1])
    seen = set()
    # World + key regions first
    region_priority = [
        "World", "Africa", "Asia", "Europe", "Northern America",
        "Latin America and the Caribbean (UN)", "Oceania",
        "Sub-Saharan Africa (UN)", "European Union (27)",
        "High-income countries", "Low-income countries",
    ]
    for r in region_priority:
        if r in entities_all and r not in seen:
            featured.append(r)
            seen.add(r)
    # Then top 30 countries by 2023 pop
    for ent, _ in pop_2023:
        if ent in seen:
            continue
        c = next((x for x in catalog if x["id"] == ent), None)
        if c and c["kind"] == "country":
            featured.append(ent)
            seen.add(ent)
            if sum(1 for f in featured if next(x for x in catalog if x["id"] == f)["kind"] == "country") >= 35:
                break

    print(f"Featured: {len(featured)}")

    # Compact timeseries: array per indicator aligned to a single year axis
    YEAR_MIN, YEAR_MAX = 1950, 2100
    years = list(range(YEAR_MIN, YEAR_MAX + 1))

    timeseries = {}
    for ent in entities_all:
        rec = {}
        # Full 1950-2100 indicators
        for key, src in [
            ("dep_total", dep_total),
            ("dep_old", dep_old),
            ("dep_young", dep_young),
            ("tfr", tfr_proj),
            ("e0", e0_hist),
            ("pop_total", pop_total),
            ("pop_0_14", pop_0_14),
            ("pop_15_64", pop_15_64),
            ("pop_65", pop_65),
            ("growth_rate", growth),
            ("natural_rate", natural),
        ]:
            d = src.get(ent, {})
            arr = []
            any_v = False
            for y in years:
                v = d.get(y)
                if v is None:
                    arr.append(None)
                else:
                    any_v = True
                    arr.append(round_to(v, 4))
            rec[key] = arr if any_v else None

        timeseries[ent] = rec

    # Output years separately so client can map indices
    payload_ts = {"years": years, "data": timeseries}

    # 2023 age structure (seed for projections)
    age_seed = {}
    for ent in entities_all:
        d = age5.get(ent, {})
        # pick most recent year available <= 2023
        candidate = None
        for y in (2023, 2022, 2021):
            if y in d:
                candidate = y
                break
        if candidate is None:
            continue
        age_seed[ent] = {"year": candidate, "pop": [round_to(v, 0) for v in d[candidate]]}

    # Demographic standards (ASFR distribution + survival ratios by life expectancy)
    # Single-sex, 5-year groups. Combined male+female assumed to have same age structure;
    # women fraction in reproductive ages assumed 0.49 (slight male skew at younger ages).
    #
    # ASFR shape: shares of TFR contributed by each 5-year group 15-19 ... 45-49.
    # Three reference patterns (early, mid, late peak), client interpolates by mean age of childbearing.
    asfr_patterns = {
        # high TFR / earlier peak (e.g. SSA pattern)
        "early": [0.10, 0.22, 0.25, 0.20, 0.14, 0.07, 0.02],
        # middle pattern (most middle-income)
        "mid":   [0.06, 0.18, 0.27, 0.24, 0.16, 0.07, 0.02],
        # later peak (developed, low TFR)
        "late":  [0.02, 0.10, 0.25, 0.32, 0.22, 0.07, 0.02],
    }
    # Verify each sums ~ 1
    for k, v in asfr_patterns.items():
        s = sum(v)
        asfr_patterns[k] = [x / s for x in v]

    # Survival ratios by 5-year age group at reference life expectancies.
    # Survival ratio s[a] = L[a+5] / L[a] from a model life table (UN-style abridged).
    # Index 0 = "0-4 surviving to 5-9", ..., index 19 = "95-99 surviving to 100+".
    # Values 50–90 are calibrated to UN-style abridged "general" model life tables.
    # Values 100–200 are smooth extrapolations: per-period mortality scales with
    # (90 / e0) ** 1.5 from the e0=90 baseline, asymptotically approaching no-mortality
    # at very high e0. The 100/120/150/200 anchors let the slider produce meaningful
    # behaviour for what-if life-extension scenarios.
    surv_e0_base = {
        50: [0.917, 0.985, 0.984, 0.978, 0.972, 0.965, 0.958, 0.949, 0.937, 0.920, 0.895, 0.860, 0.811, 0.747, 0.665, 0.561, 0.434, 0.295, 0.165, 0.072],
        60: [0.943, 0.991, 0.990, 0.985, 0.981, 0.975, 0.969, 0.961, 0.951, 0.937, 0.916, 0.886, 0.842, 0.781, 0.700, 0.594, 0.461, 0.314, 0.176, 0.077],
        70: [0.965, 0.995, 0.994, 0.991, 0.988, 0.984, 0.979, 0.973, 0.965, 0.953, 0.935, 0.908, 0.868, 0.811, 0.732, 0.626, 0.491, 0.337, 0.190, 0.083],
        80: [0.985, 0.998, 0.998, 0.997, 0.996, 0.994, 0.991, 0.987, 0.981, 0.972, 0.957, 0.934, 0.898, 0.844, 0.768, 0.664, 0.527, 0.366, 0.208, 0.092],
        85: [0.991, 0.999, 0.999, 0.998, 0.997, 0.996, 0.994, 0.991, 0.986, 0.978, 0.965, 0.945, 0.913, 0.862, 0.789, 0.687, 0.549, 0.385, 0.220, 0.098],
        90: [0.995, 0.999, 0.999, 0.999, 0.998, 0.998, 0.996, 0.994, 0.990, 0.984, 0.974, 0.957, 0.929, 0.882, 0.812, 0.712, 0.575, 0.408, 0.235, 0.106],
    }

    def extrapolate_survival(base_90, target_e0):
        """Scale per-period mortality by (90/e0)**1.5; cap survival just below 1.0."""
        factor = (90.0 / target_e0) ** 1.5
        result = []
        for s in base_90:
            m = 1.0 - s
            new_m = max(min(m * factor, 0.999), 0.0)
            result.append(round(1.0 - new_m, 4))
        return result

    surv_e0 = dict(surv_e0_base)
    for target in (100, 120, 150, 200):
        surv_e0[target] = extrapolate_survival(surv_e0_base[90], target)

    # Survival to age 0-4 from birth, by e0 (l_5 / l_0 essentially)
    # Birth survival → 1.0 at high e0 (effectively no infant mortality).
    surv_birth = {
        50: 0.875, 60: 0.928, 70: 0.965, 80: 0.987, 85: 0.992, 90: 0.996,
        100: 0.998, 120: 0.999, 150: 0.9995, 200: 0.9999,
    }

    # Net migration age distribution by 5-year group (length 21, peaks at young working ages)
    mig_age_dist = [0.01, 0.02, 0.04, 0.10, 0.16, 0.16, 0.13, 0.10, 0.08, 0.06,
                    0.04, 0.03, 0.025, 0.015, 0.010, 0.005, 0.003, 0.002, 0.001, 0.0, 0.0]
    s = sum(mig_age_dist)
    mig_age_dist = [x / s for x in mig_age_dist]
    assert len(mig_age_dist) == 21

    standards = {
        "age_groups": AGE_GROUPS_5,
        "age_starts": [i * 5 for i in range(20)] + [100],
        "asfr_patterns": asfr_patterns,
        "asfr_default": "mid",
        "surv_by_e0": surv_e0,
        "surv_birth_by_e0": surv_birth,
        "mig_age_dist": mig_age_dist,
        "women_share": 0.49,
    }

    # Write outputs
    print("Writing JSON...")
    with open(OUT / "entities.json", "w") as f:
        json.dump({"entities": catalog, "featured": featured}, f, separators=(",", ":"))
    with open(OUT / "timeseries.json", "w") as f:
        json.dump(payload_ts, f, separators=(",", ":"))
    with open(OUT / "age-2023.json", "w") as f:
        json.dump(age_seed, f, separators=(",", ":"))
    with open(OUT / "demographic-tables.json", "w") as f:
        json.dump(standards, f, separators=(",", ":"), indent=1)

    # Size report
    for fn in ["entities.json", "timeseries.json", "age-2023.json", "demographic-tables.json"]:
        sz = (OUT / fn).stat().st_size
        print(f"  {fn}: {sz/1024:.1f} KB")

    print(f"Featured entities: {len(featured)}")
    print(f"Total entities: {len(catalog)}")


if __name__ == "__main__":
    main()
