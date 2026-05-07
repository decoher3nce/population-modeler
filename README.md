# Population Modeler

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Live demo](https://img.shields.io/badge/live%20demo-population--modeler.onrender.com-46e3b7)](https://population-modeler.onrender.com/)
[![Data: UN WPP 2024](https://img.shields.io/badge/data-UN%20WPP%202024-2563eb)](https://population.un.org/wpp/)
[![Static site](https://img.shields.io/badge/build-static%20site-555)](#running-locally)
[![Deployed on Render](https://img.shields.io/badge/deploy-Render-46e3b7)](https://render.com)

Interactive web app for exploring the **dependency ratio** — the share of dependents
(ages 0–14 plus 65+) per 100 working-age adults — over time, for any country, region,
or the world. Real UN World Population Prospects 2024 data plus a cohort-component
projection engine that lets you run custom scenarios across fertility, longevity,
migration, sex ratio at birth, reproductive lifespan, retirement age, and one-shot
shock events.

🌐 **Live: https://population-modeler.onrender.com/**

---

## What it does

- **Pick any country, region, or the world** — 259 entities total, 43 featured
  (the world, all major regions, top 35 countries by population).
- **Real UN data** — historical 1950–2023 estimates and projected medium-variant values
  through 2100 from UN World Population Prospects 2024, distributed via Our World in Data.
- **Three live charts**:
  - *Dependency ratio over time* — with reference bands at 50 / 65 / 80 and a vertical
    "Pyramid" marker tied to your projection end year.
  - *Fertility & life expectancy over time* — the two slow-moving inputs that determine
    the trajectory.
  - *Population by age* — vertical age-distribution histogram with a **Bars / Line toggle**;
    seed year (e.g. 2023) and scenario end year (e.g. 2100) shown side-by-side.
- **Custom-scenario projection** — override TFR, life expectancy, net migration, sex ratio
  at birth, reproductive age max, retirement age threshold, and ASFR pattern. The
  cohort-component engine projects from the 2023 age structure forward and overlays a
  dashed line on the dep-ratio chart, a coral series on the pyramid, and a one-line
  description of the active scenario beneath the dep-ratio chart.
- **One-shot shock events** — pandemic, war, asteroid, mass migration, annexation. Year +
  signed magnitude (−40 % loss to +40 % gain) + age-band targeting (all / working / young
  / old). Migration is decoupled from the shock via a parallel unshocked baseline timeline,
  so an old-age-targeted event doesn't bleed into working-age and youth cohorts.
- **40 quick-scenario presets** in 8 optgroups (today's countries, China demographic
  transition, postwar booms & busts, wars & political shocks, disease & disasters,
  migration events, rapid transitions, speculative & theoretical).
- **"Use latest values for {entity}" sync button** — snaps every slider to the scenario
  entity's most recent UN values without searching for a matching preset.
- **Hover tooltips** on every custom-scenario control, explaining what the lever does and
  how it affects the model.
- **Bring your own data** — paste or upload a 21-row 5-year-age-group CSV. The same
  scenario sliders apply to your seed.

## Quick scenarios

| Group | Examples |
| --- | --- |
| Today's snapshots | China, Germany, Japan, Niger, South Korea, United States, World |
| China demographic transition | 1970 (pre–one-child policy), 1980 (enforced), 2000 (peak workforce) |
| Postwar booms & busts | USA 1957 baby-boom peak, Japan 1970, USA 1975 baby bust |
| Wars & political shocks | Bangladesh 1972, Cyprus 1974, Vietnam 1975, Laos 1975, Lebanon 1976, Afghanistan 1980, Cambodia 1980, Rwanda 1994, Bosnia 1995, Russia 1995, Ukraine 2022 |
| Disease & disasters | Cuba 1990, South Africa 2005 (HIV/AIDS peak), Haiti 2010 |
| Migration events | UAE 1970, Israel 1991, Qatar 2008, Germany 2015 |
| Rapid transitions | Singapore 1965 + 2020, Iran 1985 + 2015, India 1990 + 2020 |
| Speculative & theoretical | AI eldercare, anti-natalist movement, climate-driven migration, antibiotic resistance, CRISPR, sex selection, artificial wombs, radical life extension, working-age pandemic, asteroid impact, mass refugee absorption, country annexation, more |

Each preset auto-generates an explanation in a description box on the dep-ratio chart.

## Custom scenario levers

| Lever | Default | Range | Step | Affects |
| --- | --- | --- | --- | --- |
| Total fertility rate | 1.62 (USA) | 0.5 – 12.0 | 0.05 | Births per 5-year step |
| Life expectancy at birth | 79.3 | 20 – 200 | 0.5 | Survival ratios across all age bands |
| Net migration | +4.0 / 1000 | −20 to +50 | 0.5 | Annual migrants, distributed by typical age profile |
| Childbearing age pattern | Late peak | early / mid / late | — | Where in life births fall |
| Reproductive age max | 49 | 49 – 69 | 5 | Upper end of fertile window |
| Sex ratio at birth | 105 | 95 – 130 | 1 | Female share of births → replacement TFR |
| Retirement age threshold | 65 | 50 – 95 | 5 | Working / old-age boundary in dep-ratio formula |
| Project until | 2100 | 2050 / 2075 / 2100 | — | Last 5-year tick of the projection |
| Shock event | off | year × ±40 % × target | — | One-shot population perturbation |

The 5-year-step sliders (reproductive age, retirement age) are stepped to match the model's
5-year age-group resolution — values between 5-year boundaries produce identical dep-ratio
output, so the slider snaps to whole groups instead of giving the false impression of finer
granularity.

The Replacement-rate popup shows a live computed replacement TFR based on the current SRB
and life-expectancy slider values (≈ 2.10 at canonical SRB 105 + e₀ 80; rises with sex
selection and high child mortality).

---

## Model

### Cohort-component projection

The classic cohort-component method, single-sex, 5-year age groups, 5-year time steps.
Each step:

1. **Aging.** `pop[a+1] = pop[a] × s[a]`, where `s[a]` is the 5-year survival ratio at age `a`,
   interpolated from a reference table keyed by life expectancy.
2. **Births.** `B = Σ_a women[a] × TFR × p[a]`, summed over the active reproductive age groups,
   where `p[a]` is the age-specific share of TFR (the ASFR pattern, normalized over the chosen
   reproductive window). Female share = `100 / (100 + SRB)`.
3. **Birth survival.** Newborns become the next 0–4 cohort scaled by a birth-survival ratio
   (also indexed by life expectancy).
4. **Migration.** `M = base × rate / 1000 × 5`, distributed across age groups using a typical
   migrant age profile that peaks at 20–34. **`base` is the unshocked baseline population
   total**, not the current shocked total — this isolates shock effects to their targeted
   age band.
5. **Shock (optional).** Applied at the start of the 5-year period containing the shock year:
   `pop[a] *= (1 + fraction)` for `a` in the targeted band.

References: Whelpton (1936) for the original cohort-component formulation; Preston, Heuveline
& Guillot (2001), *Demography: Measuring and Modeling Population Processes*, ch. 6, for the
modern textbook treatment.

### Replacement TFR

```
replacement TFR  =  (1 + SRB / 100)  /  girl-survival-to-childbearing
```

Girl-survival is computed from the same survival table as the projection — birth survival ×
the cumulative product through the 20–24 age group. At SRB 105 and e₀ 80 this gives ≈ 2.10
(matching the canonical value); at SRB 120 it rises to 2.29; at e₀ 65 (high child mortality)
it rises to 2.37.

References: Bongaarts (2009), *Human population growth and the demographic transition*,
Phil. Trans. R. Soc. B; Espenshade et al. (2003), *The surprising global variation in
replacement fertility*, Population Research and Policy Review 22(5).

### Survival ratios

Reference values at e₀ ∈ {50, 60, 70, 80, 85, 90} are calibrated to UN-style abridged
general-pattern model life tables. Values for e₀ ∈ {100, 120, 150, 200} are extrapolated
from the e₀ = 90 baseline by scaling per-period mortality with `(90 / e₀)^1.5`, capped just
below 1.0 — a smooth approach toward no-mortality at very high life expectancy. The runtime
linearly interpolates between adjacent reference points.

References: UN Population Division (2022), *Model Life Tables for Developing Countries*;
Coale & Demeny (1966), *Regional Model Life Tables and Stable Populations*.

### Net migration derivation

OWID does not publish UN-WPP net migration directly in the slug we consume. We derive it
implicitly:

```
net migration rate (per 1000)  =  10 × (growth rate − natural change rate)
```

Both component rates are reported per 100 in the OWID
[`population-growth-rate-with-and-without-migration`](https://ourworldindata.org/grapher/population-growth-rate-with-and-without-migration)
extract; the factor of 10 converts to per-mille.

---

## Limitations

The model is intentionally simple — for what-if scenario thinking, not for replacing UN
demographic forecasts.

- **No sex disaggregation.** Combined-sex with a parametric female share derived from SRB.
- **Constant inputs across the projection window.** TFR, life expectancy, migration, etc.
  are held fixed across the projection horizon. UN variants modulate these over time, so
  this model will diverge from UN's even when seeded with similar starting values.
- **Three ASFR pattern shapes** (early / mid / late peak). Real countries have unique patterns.
- **Migration is exogenous and uniform per year.** Surges, skill/age selectivity beyond the
  standard pattern, and origin-mix shifts are not modeled.
- **Survival above e₀ = 90 is extrapolated**, not directly calibrated against empirical data
  (no country has ever sustained an e₀ above ~85).

---

## Data sources

All real-data baselines come from the
[**UN World Population Prospects 2024**](https://population.un.org/wpp/) (UN Department of
Economic and Social Affairs, Population Division). The project consumes the data through
[**Our World in Data**](https://ourworldindata.org/) Grapher CSV exports (which mirror UN WPP
2024 with their own QA).

Specific OWID grapher slugs:

| Slug | Used for |
| --- | --- |
| [age-dependency-ratio-projected-to-2100](https://ourworldindata.org/grapher/age-dependency-ratio-projected-to-2100) | Total dependency ratio, historical + medium-variant projection |
| [age-dependency-ratio-old](https://ourworldindata.org/grapher/age-dependency-ratio-old) | Old-age dependency ratio |
| [age-dependency-ratio-young-of-working-age-population](https://ourworldindata.org/grapher/age-dependency-ratio-young-of-working-age-population) | Youth dependency ratio |
| [fertility-rate-with-projections](https://ourworldindata.org/grapher/fertility-rate-with-projections) | TFR, historical + projection |
| [life-expectancy](https://ourworldindata.org/grapher/life-expectancy) | Life expectancy at birth |
| [population-young-working-elderly-with-projections](https://ourworldindata.org/grapher/population-young-working-elderly-with-projections) | Population by broad age group (0–14, 15–64, 65+) |
| [population-by-five-year-age-group](https://ourworldindata.org/grapher/population-by-five-year-age-group) | 5-year age structure (the projection seed) |
| [population-unwpp](https://ourworldindata.org/grapher/population-unwpp) | Total population |
| [population-growth-rate-with-and-without-migration](https://ourworldindata.org/grapher/population-growth-rate-with-and-without-migration) | Net migration derived as growth − natural change |

The raw CSVs are kept under [`raw-data/`](./raw-data) and the build script that turns them
into the bundled JSON shipped to the client lives at
[`scripts/build-data.py`](./scripts/build-data.py), so anyone can rebuild the data pipeline
end-to-end.

---

## Running locally

The app is a static site — no build step, no server.

```bash
python3 -m http.server 8765 --directory public
# open http://localhost:8765/
```

To rebuild the bundled JSON from the raw CSVs:

```bash
python3 scripts/build-data.py
```

## Deploying

This repo includes a [Render Blueprint](https://render.com/docs/blueprint-spec)
([`render.yaml`](./render.yaml)).

1. Fork to GitHub.
2. In Render: **New ▸ Blueprint** → select fork.
3. Render auto-detects `render.yaml` and provisions a free static site.
4. Subsequent pushes to the default branch auto-deploy.

No backend, no env vars.

## Project structure

```
population-modeler/
├── README.md
├── LICENSE
├── render.yaml                 Render Blueprint
├── public/                     Static site (deployed)
│   ├── index.html
│   ├── styles.css
│   ├── app.js                  UI, chart wiring, preset library
│   ├── projection.js           Cohort-component engine + replacement-TFR helper
│   └── data/                   Bundled JSON, generated from raw CSVs
│       ├── entities.json
│       ├── timeseries.json
│       ├── age-2023.json
│       └── demographic-tables.json
├── scripts/
│   └── build-data.py           OWID/UN CSV → bundled JSON
└── raw-data/                   OWID CSV exports
```

---

## References

- United Nations, Department of Economic and Social Affairs, Population Division (2024).
  [*World Population Prospects 2024: Methodology Report*](https://population.un.org/wpp/assets/Files/WPP2024_Methodology-Report_Final.pdf).
- Preston, S. H., Heuveline, P., & Guillot, M. (2001). *Demography: Measuring and Modeling
  Population Processes*. Blackwell. — canonical textbook for the cohort-component method.
- Whelpton, P. K. (1936). *An empirical method of calculating future population.*
  Journal of the American Statistical Association, 31(195), 457–473. — original cohort-component paper.
- Bongaarts, J. (2009). *Human population growth and the demographic transition.*
  Philosophical Transactions of the Royal Society B, 364(1532), 2985–2990.
- Espenshade, T. J., Guzman, J. C., & Westoff, C. F. (2003). *The surprising global variation
  in replacement fertility.* Population Research and Policy Review, 22(5–6), 575–583.
- Coale, A. J., & Demeny, P. (1966). *Regional Model Life Tables and Stable Populations.*
  Princeton University Press.
- Roser, M., & Rodés-Guirao, L. (2019/2024). [*Fertility rate*](https://ourworldindata.org/fertility-rate)
  and related entries on Our World in Data.

## Acknowledgments

The project framework is inspired by Max Fisher's
[*How China blew up its own future*](https://www.youtube.com/watch?v=AultJcNb90c).

## License

[MIT](./LICENSE). Underlying demographic data is licensed under the terms of its original
publishers (UN WPP and Our World in Data).
