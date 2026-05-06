# Population Modeler

An interactive web app for exploring the **dependency ratio** — the share of dependents
(ages 0–14 plus 65+) per 100 working-age adults — over time, for any country, region, or
the whole world. Real UN World Population Prospects 2024 data plus a cohort-component
projection engine that lets you explore custom scenarios.

> **Live demo:** _set after the first Render deploy_

## Why dependency ratio?

The dependency ratio compresses a society's economic load-bearing capacity into one number.
It sits on top of two slow-moving inputs — fertility 20 years ago and life expectancy —
and both are observable today, which makes the next few decades unusually predictable.

Max Fisher's video [_How China blew up its own future_](https://www.youtube.com/watch?v=AultJcNb90c)
uses this single number as the calibration spine for the entire China demography argument.
He quotes a rounded scale that this app embeds as reference bands:

| Dependency ratio | Reading | Example |
| ---: | --- | --- |
| ~45 | healthy | China today |
| ~55 | fine | US today |
| ~65 | national crisis | France today |
| ~70 | national decline | Japan today |
| ~80 | emergency | China 1970s (triggered the one-child policy) |
| ~128 | unprecedented | China projected 2100 (UN medium variant) |

## Features

- **Pick any country, region, or the world.** 259 entities total, with 43 featured
  (the world, all major regions, top 35 countries by population).
- **Real UN data.** Historical 1950–2023 estimates and projected 2024–2100 medium-variant
  values from UN World Population Prospects 2024.
- **Compare entities** on one chart with reference bands.
- **Custom scenarios.** Override total fertility rate, life expectancy at birth, and
  net migration rate. The cohort-component engine projects forward from the 2023 age
  structure to 2100 (or 2150) and overlays a dashed line on the chart.
- **Quick presets** — Replacement, Japan-trend, China 2100, +Immigration, Reset.
- **Use your own data.** Paste or upload a CSV with a 21-row 5-year age structure
  (`0_4`, `5_9`, …, `100plus`). The same scenario sliders apply to your seed.
- **Three chart views** — dependency ratio over time, drivers (TFR + life expectancy),
  and the population pyramid (2023 vs. scenario end-year).

## Methodology

### Real-data baseline
- Historical estimates 1950–2023 and projected medium-variant values 2024–2100 from
  the [UN World Population Prospects 2024](https://population.un.org/wpp/), distributed
  via [Our World in Data](https://ourworldindata.org/fertility-rate).
- Indicators used: dependency ratio (total, young, old), total fertility rate, life
  expectancy at birth, population by broad and 5-year age groups.
- Net migration rate is derived implicitly as
  *(population growth rate) − (natural change rate)*.

### Custom-scenario projection engine
A deterministic single-sex cohort-component model on 5-year age groups and 5-year
time steps. Starting from the 2023 5-year age structure, each step:

1. Ages each cohort forward one bin, applying age-specific survival ratios interpolated
   to the chosen life expectancy (reference values at e0 = 50, 60, 70, 80, 85, 90).
2. Generates births = Σ (women in 5-year reproductive group × TFR × ASFR-share),
   with women assumed 49% of each cohort and shares from the chosen ASFR pattern
   (early / mid / late peak).
3. Survives newborns to ages 0–4 using a birth-survival ratio also indexed by life
   expectancy.
4. Adds net migrants = (total population × net-migration rate / 1000 × 5), distributed
   across age groups using a typical migrant age profile (peaks at 20–34).

Reference survival ratios are calibrated to a UN-style abridged general-pattern model
life table.

### Limitations
- **No sex disaggregation.** Combined-sex with a fixed women-share (49%); real
  fertility and mortality differ by sex.
- **Constant scenario inputs.** TFR, life expectancy, and migration rate are held
  fixed across the projection; UN's variants modulate these over time, so our model
  will diverge from theirs even when seeded with similar starting values.
- **Standard ASFR pattern.** Three preset shapes (early/mid/late peak); real countries
  have unique patterns.
- **Migration is exogenous and uniform per-year.** Surges and skill/age selectivity
  beyond the standard pattern are not modeled.
- **Treat as a what-if scenario engine, not a forecast.** Use UN WPP for forecasts.

## Running locally

The app is a static site — no build step, no server. Any HTTP file server works.

```bash
# Python (built-in)
python3 -m http.server 8765 --directory public
# then open http://localhost:8765/
```

To rebuild the bundled JSON from the raw CSVs (only needed if you update the source data):

```bash
# 1. Refresh raw OWID exports (script not included; URLs are listed in scripts/build-data.py)
# 2. Regenerate the bundled JSON
python3 scripts/build-data.py
```

## Deploying to Render

This repo includes a [Render Blueprint](https://render.com/docs/blueprint-spec) at
[`render.yaml`](./render.yaml). To deploy:

1. Push this repo to GitHub.
2. In the Render dashboard, click **New ▸ Blueprint** and select your fork.
3. Render auto-detects `render.yaml` and provisions a free static site.
4. Subsequent pushes to the default branch auto-deploy.

The site has no backend or environment variables, so deployment is plug-and-play.

## Project structure

```
population-modeler/
├── README.md
├── render.yaml                 Render Blueprint (static site)
├── public/                     The static site (this is what Render serves)
│   ├── index.html
│   ├── styles.css
│   ├── app.js                  UI + chart wiring
│   ├── projection.js           Cohort-component projection engine
│   └── data/                   Bundled JSON, generated from raw CSVs
│       ├── entities.json
│       ├── timeseries.json
│       ├── age-2023.json
│       └── demographic-tables.json
├── scripts/
│   └── build-data.py           Converts raw OWID/UN CSVs → bundled JSON
└── raw-data/                   The OWID CSVs the build script consumes
```

## Data sources

- [UN World Population Prospects 2024](https://population.un.org/wpp/) — primary source
- [Our World in Data — Fertility Rate](https://ourworldindata.org/fertility-rate) — distribution layer
- Specific OWID grapher slugs used:
  - `age-dependency-ratio-projected-to-2100`
  - `age-dependency-ratio-old`
  - `age-dependency-ratio-young-of-working-age-population`
  - `fertility-rate-with-projections`
  - `life-expectancy`
  - `population-young-working-elderly-with-projections`
  - `population-by-five-year-age-group`
  - `population-unwpp`
  - `population-growth-rate-with-and-without-migration`

## Inspiration

[_How China blew up its own future_](https://www.youtube.com/watch?v=AultJcNb90c) by
Max Fisher — the video that frames Fisher's reading of the dependency ratio as
**"the system or the nation"**: China can preserve its single-party / ethnic-purity
political identity at the cost of a demographic decline so severe that the second half
of the "Chinese century" turns the country into the largest nursing home in human
history — or it can change (notably by accepting immigration) at the cost of
compromising the political and social system its leadership treats as the engine of
its rise.

## License

MIT. Demographic data is licensed under the terms of its original publishers
(UN WPP and Our World in Data).
