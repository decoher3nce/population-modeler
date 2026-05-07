import { project, dependencyRatio, setStandards } from "./projection.js";

// Build version — bumped to bust browser caches when bundled JSON changes.
const DATA_VERSION = "11";

// Distinct colour palette (10 series).
const PALETTE = [
  "#58a6ff", "#f97583", "#3fb950", "#d29922", "#bc8cff",
  "#ff9e64", "#79c0ff", "#a5d6ff", "#56d4dd", "#f47067",
];

const REFERENCE_BANDS = [
  { y0: 0,   y1: 50,  color: "rgba(63, 185, 80, 0.10)",  label: "≤ 50 healthy" },
  { y0: 50,  y1: 65,  color: "rgba(210, 153, 34, 0.12)", label: "50–65 strain" },
  { y0: 65,  y1: 80,  color: "rgba(248, 81, 73, 0.10)",  label: "65–80 decline" },
  { y0: 80,  y1: 200, color: "rgba(210, 84, 138, 0.13)", label: "80+ crisis" },
];

// Numeric reference markers; no descriptive labels, since the bands are
// generic (not tied to any specific country narrative).
const REFERENCE_LINES = [
  { y: 50 },
  { y: 65 },
  { y: 80 },
];

// State
const state = {
  entities: [],          // catalog
  featured: [],
  timeseries: null,      // { years, data }
  ageSeed: null,         // { entityId: { year, pop[] } }
  standards: null,
  selected: [],          // entity ids on chart
  scenarioEntity: null,
  scenarioOn: false,
  customSeed: null,      // { id, name, year, pop[] } if user uploaded
  scenario: { tfr: 2.1, e0: 80, netMigPer1000: 0, asfrPattern: "mid", endYear: 2100 },
  charts: { dep: null, driver: null, pyramid: null },
};

const CUSTOM_ID = "__custom__";

// ---------- data load ----------

async function fetchJson(url) {
  // The version query string forces re-fetch when DATA_VERSION is bumped, even if a
  // stale 404 was cached from an earlier broken deploy.
  const sep = url.includes("?") ? "&" : "?";
  const r = await fetch(`${url}${sep}v=${DATA_VERSION}`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
  return r.json();
}

async function loadData() {
  const [entities, ts, seed, std] = await Promise.all([
    fetchJson("data/entities.json"),
    fetchJson("data/timeseries.json"),
    fetchJson("data/age-2023.json"),
    fetchJson("data/demographic-tables.json"),
  ]);
  state.entities = entities.entities;
  state.featured = entities.featured;
  state.timeseries = ts;
  state.ageSeed = seed;
  state.standards = std;
  setStandards(std);
}

// ---------- entity selection UI ----------

function ent(id) {
  if (id === CUSTOM_ID && state.customSeed) {
    return { id: CUSTOM_ID, name: state.customSeed.name, kind: "custom" };
  }
  return state.entities.find((e) => e.id === id);
}

function renderEntityList(filter = "") {
  const select = document.getElementById("entity-select");
  select.innerHTML = "";
  const f = filter.trim().toLowerCase();
  let list;
  if (f === "") {
    list = state.featured.map((id) => ent(id)).filter(Boolean);
  } else {
    list = state.entities.filter((e) => e.name.toLowerCase().includes(f));
  }
  for (const e of list.slice(0, 200)) {
    const o = document.createElement("option");
    o.value = e.id;
    const tag = e.kind === "region" ? "🌐" : "🏳";
    o.textContent = `${tag}  ${e.name}`;
    select.appendChild(o);
  }
}

function renderSelectedChips() {
  const host = document.getElementById("selected-entities");
  host.innerHTML = "";
  state.selected.forEach((id, i) => {
    const e = ent(id);
    if (!e) return;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>${e.name}<button type="button" data-id="${id}" title="remove">×</button>`;
    host.appendChild(chip);
  });
  host.querySelectorAll("button[data-id]").forEach((b) => {
    b.addEventListener("click", () => {
      state.selected = state.selected.filter((x) => x !== b.dataset.id);
      renderSelectedChips();
      refreshAllCharts();
    });
  });
}

function renderScenarioEntityOptions() {
  const sel = document.getElementById("scenario-entity");
  sel.innerHTML = "";
  // Selected entities are first-class options for the scenario
  const ids = [...state.selected];
  if (state.customSeed && !ids.includes(CUSTOM_ID)) ids.unshift(CUSTOM_ID);
  if (ids.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "(add an entity above first)";
    opt.value = "";
    sel.appendChild(opt);
    return;
  }
  for (const id of ids) {
    const e = ent(id);
    if (!e) continue;
    const o = document.createElement("option");
    o.value = id;
    o.textContent = e.name;
    sel.appendChild(o);
  }
  if (!ids.includes(state.scenarioEntity)) state.scenarioEntity = ids[0];
  sel.value = state.scenarioEntity;
}

// ---------- baseline timeseries ----------

function getBaselineSeries(entityId, key) {
  if (entityId === CUSTOM_ID) return null;
  const rec = state.timeseries.data[entityId];
  if (!rec || !rec[key]) return null;
  const years = state.timeseries.years;
  return years.map((y, i) => ({ x: y, y: rec[key][i] })).filter((p) => p.y != null);
}

// ---------- scenario projection ----------

function buildScenarioProjection() {
  if (!state.scenarioEntity) return null;
  const id = state.scenarioEntity;
  let seed, seedYear;
  if (id === CUSTOM_ID) {
    if (!state.customSeed) return null;
    seed = state.customSeed.pop;
    seedYear = state.customSeed.year;
  } else {
    const s = state.ageSeed[id];
    if (!s) return null;
    seed = s.pop;
    seedYear = s.year;
  }
  const sc = state.scenario;
  const result = project(seed, seedYear, sc.endYear, {
    tfr: sc.tfr,
    e0: sc.e0,
    netMigPer1000: sc.netMigPer1000,
    asfrPattern: sc.asfrPattern,
  });
  return result;
}

// ---------- chart construction ----------

function pyramidYearAnnotation() {
  // Only add if there's a meaningful projection target (i.e. the pyramid is showing
  // a future bar). Returns null otherwise so the line is suppressed.
  const id = state.scenarioEntity;
  if (!id) return null;
  if (id === CUSTOM_ID && !state.customSeed) return null;
  if (id !== CUSTOM_ID && !state.ageSeed[id]) return null;
  const y = state.scenario.endYear;
  return {
    type: "line",
    xMin: y, xMax: y,
    borderColor: "rgba(249,117,131,0.6)",
    borderWidth: 1.25,
    borderDash: [4, 4],
    label: {
      display: true,
      content: `Pyramid: ${y}`,
      position: "start",
      backgroundColor: "rgba(20,20,20,0.7)",
      color: "#f0c0c4",
      font: { size: 10, weight: "500" },
      padding: { top: 3, bottom: 3, left: 6, right: 6 },
      borderRadius: 3,
    },
  };
}

function annotationsForDep() {
  const ann = {};
  REFERENCE_BANDS.forEach((b, i) => {
    ann[`b${i}`] = {
      type: "box",
      yMin: b.y0, yMax: b.y1,
      backgroundColor: b.color,
      borderWidth: 0,
    };
  });
  REFERENCE_LINES.forEach((l, i) => {
    ann[`l${i}`] = {
      type: "line",
      yMin: l.y, yMax: l.y,
      borderColor: "rgba(255,255,255,0.18)",
      borderWidth: 1,
      borderDash: [3, 3],
    };
  });
  const py = pyramidYearAnnotation();
  if (py) ann.pyramidYear = py;
  return ann;
}

function annotationsForDriver() {
  const ann = {};
  const py = pyramidYearAnnotation();
  if (py) ann.pyramidYear = py;
  return ann;
}

function buildDepDatasets() {
  const datasets = [];
  state.selected.forEach((id, i) => {
    const e = ent(id);
    if (!e) return;
    const color = PALETTE[i % PALETTE.length];
    if (id === CUSTOM_ID) return; // custom handled by scenario overlay
    const t = getBaselineSeries(id, "dep_total");
    if (t) datasets.push({ label: e.name, data: t, borderColor: color, backgroundColor: color + "20", borderWidth: 2, pointRadius: 0, tension: 0.2 });
  });

  if (state.scenarioOn) {
    const proj = buildScenarioProjection();
    if (proj) {
      const ix = state.selected.indexOf(state.scenarioEntity);
      const color = PALETTE[(ix >= 0 ? ix : state.selected.length) % PALETTE.length];
      const eName = ent(state.scenarioEntity)?.name || "Scenario";
      datasets.push({
        label: `${eName} — custom scenario`,
        data: proj.map((p) => ({ x: p.year, y: p.total })),
        borderColor: color,
        borderWidth: 2.5,
        borderDash: [8, 4],
        pointRadius: 0,
        backgroundColor: "transparent",
        tension: 0.1,
      });
    }
  }
  return datasets;
}

function buildDriverDatasets() {
  const datasets = [];
  state.selected.forEach((id, i) => {
    if (id === CUSTOM_ID) return;
    const e = ent(id);
    if (!e) return;
    const color = PALETTE[i % PALETTE.length];
    const tfr = getBaselineSeries(id, "tfr");
    const e0 = getBaselineSeries(id, "e0");
    if (tfr) datasets.push({ label: `${e.name} — Total fertility rate`, data: tfr, borderColor: color, borderWidth: 2, pointRadius: 0, yAxisID: "y", tension: 0.2 });
    if (e0) datasets.push({ label: `${e.name} — Life exp.`, data: e0, borderColor: color, borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, yAxisID: "y1", tension: 0.2 });
  });
  return datasets;
}

function formatPopulation(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} B`;
  if (n >= 100e6) return `${Math.round(n / 1e6)} M`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} K`;
  return `${Math.round(n)}`;
}

function buildPyramidDatasets() {
  if (!state.scenarioEntity) return { labels: [], datasets: [] };
  const id = state.scenarioEntity;
  let seed, seedLabel, entityName;
  if (id === CUSTOM_ID) {
    if (!state.customSeed) return { labels: [], datasets: [] };
    seed = state.customSeed.pop;
    entityName = state.customSeed.name;
    seedLabel = `${entityName} in ${state.customSeed.year}`;
  } else {
    const s = state.ageSeed[id];
    if (!s) return { labels: [], datasets: [] };
    seed = s.pop;
    entityName = ent(id).name;
    seedLabel = `${entityName} in ${s.year}`;
  }
  const proj = buildScenarioProjection();
  const endStep = proj ? proj[proj.length - 1] : null;
  // Use the user-selected end year for the label (round number) rather than
  // the actual final 5-year step (e.g. 2098), since "close enough" is what users see.
  const displayEndYear = state.scenario.endYear;
  const labels = state.standards.age_groups.map((g) => g.replace("_", "–").replace("plus", "+"));
  const ds = [
    { label: seedLabel, data: seed.map((v) => v / 1e6), backgroundColor: "rgba(88,166,255,0.55)", borderColor: "#58a6ff", borderWidth: 1 },
  ];
  if (endStep) {
    ds.push({
      label: `${entityName} in ${displayEndYear}`,
      data: endStep.pop.map((v) => v / 1e6),
      backgroundColor: "rgba(249,117,131,0.55)",
      borderColor: "#f97583",
      borderWidth: 1,
    });
  }
  return { labels, datasets: ds };
}

function refreshPyramidStats() {
  const host = document.getElementById("pyramid-stats");
  if (!host) return;
  const id = state.scenarioEntity;
  if (!id) {
    host.style.display = "none";
    return;
  }

  let seedYear = null, seedTotal = null, entityName;
  if (id === CUSTOM_ID) {
    if (!state.customSeed) {
      host.style.display = "none";
      return;
    }
    seedYear = state.customSeed.year;
    seedTotal = state.customSeed.pop.reduce((a, b) => a + b, 0);
    entityName = state.customSeed.name;
  } else {
    const s = state.ageSeed[id];
    if (!s) {
      host.style.display = "none";
      return;
    }
    seedYear = s.year;
    seedTotal = s.pop.reduce((a, b) => a + b, 0);
    entityName = ent(id).name;
  }

  const proj = buildScenarioProjection();
  let endYear = null, endTotal = null;
  if (proj && proj.length > 1) {
    endYear = state.scenario.endYear;
    endTotal = proj[proj.length - 1].sumPop;
  }

  host.style.display = "";
  document.getElementById("pyramid-stat-now-text").textContent =
    `Population in ${seedYear}: ${formatPopulation(seedTotal)}`;
  const futureRow = document.getElementById("pyramid-stat-future");
  if (endYear != null) {
    futureRow.style.display = "";
    document.getElementById("pyramid-stat-future-text").textContent =
      `Population in ${endYear}: ${formatPopulation(endTotal)}`;
  } else {
    futureRow.style.display = "none";
  }
}

function makeDepChart() {
  const ctx = document.getElementById("dep-chart");
  state.charts.dep = new Chart(ctx, {
    type: "line",
    data: { datasets: buildDepDatasets() },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { labels: { color: "#cdd6e0", font: { size: 12 } } },
        tooltip: {
          callbacks: {
            title: (items) => `Year ${items[0].parsed.x}`,
            label: (item) => `${item.dataset.label}: ${item.parsed.y.toFixed(1)}`,
          },
        },
        annotation: { annotations: annotationsForDep() },
      },
      scales: {
        x: {
          type: "linear",
          min: 1950, max: 2100,
          ticks: { color: "#8b949e", stepSize: 25 },
          grid: { color: "#21262d" },
          title: { display: true, text: "Year", color: "#8b949e" },
        },
        y: {
          min: 0,
          suggestedMax: 150,
          ticks: { color: "#8b949e" },
          grid: { color: "#21262d" },
          title: { display: true, text: "Dependency ratio (per 100 working-age)", color: "#8b949e" },
        },
      },
    },
  });
}

function makeDriverChart() {
  const ctx = document.getElementById("driver-chart");
  state.charts.driver = new Chart(ctx, {
    type: "line",
    data: { datasets: buildDriverDatasets() },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { labels: { color: "#cdd6e0", font: { size: 11 } } },
        tooltip: {
          callbacks: {
            title: (items) => `Year ${items[0].parsed.x}`,
            label: (item) => `${item.dataset.label}: ${item.parsed.y.toFixed(2)}`,
          },
        },
        annotation: { annotations: annotationsForDriver() },
      },
      scales: {
        x: { type: "linear", min: 1950, max: 2100, ticks: { color: "#8b949e", stepSize: 25 }, grid: { color: "#21262d" } },
        y: {
          position: "left",
          min: 0, max: 8,
          ticks: { color: "#8b949e" },
          grid: { color: "#21262d" },
          title: { display: true, text: "Total fertility rate (children/woman)", color: "#8b949e" },
        },
        y1: {
          position: "right",
          min: 30, max: 95,
          ticks: { color: "#8b949e" },
          grid: { display: false },
          title: { display: true, text: "Life expectancy (years)", color: "#8b949e" },
        },
      },
    },
  });
}

function makePyramidChart() {
  const ctx = document.getElementById("pyramid-chart");
  const data = buildPyramidDatasets();
  state.charts.pyramid = new Chart(ctx, {
    type: "bar",
    data,
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: { labels: { color: "#cdd6e0", font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${item.parsed.x.toFixed(2)} M`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#8b949e" },
          grid: { color: "#21262d" },
          title: { display: true, text: "Population (millions)", color: "#8b949e" },
        },
        y: {
          ticks: { color: "#8b949e", autoSkip: false, font: { size: 10 } },
          grid: { color: "#21262d" },
          reverse: true,
          title: { display: true, text: "Age group", color: "#8b949e" },
        },
      },
    },
  });
}

function refreshPyramidTitle() {
  const el = document.getElementById("pyramid-title");
  if (!el) return;
  const id = state.scenarioEntity;
  let seedYear = 2023;
  if (id === CUSTOM_ID && state.customSeed) seedYear = state.customSeed.year;
  else if (id && state.ageSeed[id]) seedYear = state.ageSeed[id].year;
  const endYear = state.scenario.endYear;
  el.textContent = `Population pyramid (${seedYear} vs ${endYear})`;
}

function refreshAllCharts() {
  // Dep
  state.charts.dep.data.datasets = buildDepDatasets();
  state.charts.dep.options.plugins.annotation.annotations = annotationsForDep();
  state.charts.dep.update("none");

  // Driver
  state.charts.driver.data.datasets = buildDriverDatasets();
  state.charts.driver.options.plugins.annotation.annotations = annotationsForDriver();
  state.charts.driver.update("none");

  // Pyramid
  refreshPyramidTitle();
  const pData = buildPyramidDatasets();
  state.charts.pyramid.data.labels = pData.labels;
  state.charts.pyramid.data.datasets = pData.datasets;
  state.charts.pyramid.update("none");
  refreshPyramidStats();
}

// ---------- presets ----------

// Preset shapes:
//   { type: "snapshot",   id, group, label, entity }
//        switch entity, set sliders to that entity's latest known values.
//   { type: "historical", id, group, label, entity, year }
//        switch entity, set sliders to that entity's values from `year`.
//   { type: "values",     id, group, label, values }
//        set sliders only; do not change scenario entity.
//   { type: "reset",      id, group, label }
//        reset to USA today (page default).
const PRESETS = [
  // Today's snapshots
  { type: "snapshot",   id: "us-today",      group: "Today's snapshots", label: "United States today",  entity: "United States" },
  { type: "snapshot",   id: "china-today",   group: "Today's snapshots", label: "China today",          entity: "China" },
  { type: "snapshot",   id: "japan-today",   group: "Today's snapshots", label: "Japan today",          entity: "Japan" },
  { type: "snapshot",   id: "korea-today",   group: "Today's snapshots", label: "South Korea today",    entity: "South Korea" },
  { type: "snapshot",   id: "germany-today", group: "Today's snapshots", label: "Germany today",        entity: "Germany" },
  { type: "snapshot",   id: "niger-today",   group: "Today's snapshots", label: "Niger today",          entity: "Niger" },
  { type: "snapshot",   id: "world-today",   group: "Today's snapshots", label: "World today",          entity: "World" },

  // China demographic transition
  { type: "historical", id: "china-1970", group: "China demographic transition", label: "China 1970 — pre–one-child policy",      entity: "China", year: 1970 },
  { type: "historical", id: "china-1980", group: "China demographic transition", label: "China 1980 — one-child policy enforced", entity: "China", year: 1980 },
  { type: "historical", id: "china-2000", group: "China demographic transition", label: "China 2000 — peak workforce",            entity: "China", year: 2000 },

  // Postwar booms & busts
  { type: "historical", id: "us-1957",    group: "Postwar booms & busts", label: "United States 1957 — baby-boom peak",  entity: "United States", year: 1957 },
  { type: "historical", id: "us-1975",    group: "Postwar booms & busts", label: "United States 1975 — baby bust",       entity: "United States", year: 1975 },
  { type: "historical", id: "japan-1970", group: "Postwar booms & busts", label: "Japan 1970 — industrial peak",         entity: "Japan",         year: 1970 },

  // Wars & political shocks
  { type: "historical", id: "vietnam-1975",    group: "Wars & political shocks", label: "Vietnam 1975 — end of war",                  entity: "Vietnam",                year: 1975 },
  { type: "historical", id: "laos-1975",       group: "Wars & political shocks", label: "Laos 1975 — Pathet Lao victory",              entity: "Laos",                   year: 1975 },
  { type: "historical", id: "cambodia-1980",   group: "Wars & political shocks", label: "Cambodia 1980 — post–Khmer Rouge",            entity: "Cambodia",               year: 1980 },
  { type: "historical", id: "bangladesh-1972", group: "Wars & political shocks", label: "Bangladesh 1972 — independence + 1971 famine", entity: "Bangladesh",            year: 1972 },
  { type: "historical", id: "cyprus-1974",     group: "Wars & political shocks", label: "Cyprus 1974 — Turkish invasion",              entity: "Cyprus",                 year: 1974 },
  { type: "historical", id: "lebanon-1976",    group: "Wars & political shocks", label: "Lebanon 1976 — civil war low point",          entity: "Lebanon",                year: 1976 },
  { type: "historical", id: "afghanistan-1980",group: "Wars & political shocks", label: "Afghanistan 1980 — Soviet invasion",          entity: "Afghanistan",            year: 1980 },
  { type: "historical", id: "bosnia-1995",     group: "Wars & political shocks", label: "Bosnia 1995 — war end / refugee return",      entity: "Bosnia and Herzegovina", year: 1995 },
  { type: "historical", id: "rwanda-1994",     group: "Wars & political shocks", label: "Rwanda 1994 — genocide year",                 entity: "Rwanda",                 year: 1994 },
  { type: "historical", id: "russia-1995",     group: "Wars & political shocks", label: "Russia 1995 — post-Soviet collapse",          entity: "Russia",                 year: 1995 },
  { type: "historical", id: "ukraine-2022",    group: "Wars & political shocks", label: "Ukraine 2022 — Russian invasion",             entity: "Ukraine",                year: 2022 },

  // Disease & disasters
  { type: "historical", id: "south-africa-2005", group: "Disease & disasters", label: "South Africa 2005 — HIV/AIDS peak",  entity: "South Africa", year: 2005 },
  { type: "historical", id: "haiti-2010",        group: "Disease & disasters", label: "Haiti 2010 — earthquake",            entity: "Haiti",        year: 2010 },
  { type: "historical", id: "cuba-1990",         group: "Disease & disasters", label: "Cuba 1990 — Special Period",         entity: "Cuba",         year: 1990 },

  // Migration events
  { type: "historical", id: "germany-2015", group: "Migration events", label: "Germany 2015 — refugee influx",         entity: "Germany",              year: 2015 },
  { type: "historical", id: "israel-1991",  group: "Migration events", label: "Israel 1991 — Soviet immigration wave", entity: "Israel",               year: 1991 },
  { type: "historical", id: "uae-1970",     group: "Migration events", label: "UAE 1970 — early oil-boom labour influx",entity: "United Arab Emirates", year: 1970 },
  { type: "historical", id: "qatar-2008",   group: "Migration events", label: "Qatar 2008 — peak expat boom",          entity: "Qatar",                year: 2008 },

  // Rapid transitions
  { type: "historical", id: "india-1990",     group: "Rapid transitions", label: "India 1990 — pre-transition",            entity: "India",     year: 1990 },
  { type: "historical", id: "india-2020",     group: "Rapid transitions", label: "India 2020 — near replacement",          entity: "India",     year: 2020 },
  { type: "historical", id: "iran-1985",      group: "Rapid transitions", label: "Iran 1985 — post-revolution baby boom",  entity: "Iran",      year: 1985 },
  { type: "historical", id: "iran-2015",      group: "Rapid transitions", label: "Iran 2015 — after rapid transition",     entity: "Iran",      year: 2015 },
  { type: "historical", id: "singapore-1965", group: "Rapid transitions", label: "Singapore 1965 — pre-development",       entity: "Singapore", year: 1965 },
  { type: "historical", id: "singapore-2020", group: "Rapid transitions", label: "Singapore 2020 — ultra-low fertility",   entity: "Singapore", year: 2020 },

  // Theoretical
  { type: "values", id: "replacement", group: "Theoretical", label: "Replacement (TFR 2.1, e₀ 80)",
    values: { tfr: 2.10, e0: 80, netMigPer1000: 0, asfrPattern: "mid" } },

  // Reset
  { type: "reset",  id: "reset", group: "—", label: "Reset to United States today" },
];

function renderPresets() {
  const sel = document.getElementById("preset-select");
  if (!sel) return;
  // Keep the placeholder and rebuild the option groups
  sel.innerHTML = '<option value="" selected>— pick a scenario —</option>';

  const grouped = new Map();
  PRESETS.forEach((p) => {
    // Skip entity-anchored presets if the entity is missing from our catalog
    if ((p.type === "snapshot" || p.type === "historical") &&
        !state.entities.some((e) => e.id === p.entity)) return;
    if (p.type === "historical") {
      // Verify we actually have data for that year
      const yIdx = state.timeseries.years.indexOf(p.year);
      const ts = state.timeseries.data[p.entity];
      if (yIdx < 0 || !ts || (ts.tfr?.[yIdx] == null && ts.e0?.[yIdx] == null)) return;
    }
    if (!grouped.has(p.group)) grouped.set(p.group, []);
    grouped.get(p.group).push(p);
  });

  // Sort each group:
  //   Today's snapshots → alphabetical by label
  //   Theoretical / loose → preserve definition order
  //   Everything else (date-anchored historical groups) → chronological by year
  for (const [groupName, items] of grouped.entries()) {
    if (groupName === "Today's snapshots") {
      items.sort((a, b) => a.label.localeCompare(b.label));
    } else if (groupName !== "Theoretical" && groupName !== "—") {
      items.sort((a, b) => {
        const ay = a.year ?? Number.POSITIVE_INFINITY;
        const by = b.year ?? Number.POSITIVE_INFINITY;
        if (ay !== by) return ay - by;
        return a.label.localeCompare(b.label);
      });
    }
  }

  for (const [groupName, items] of grouped.entries()) {
    if (groupName === "—") {
      // Loose options at the end (e.g. Reset)
      items.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.label;
        sel.appendChild(opt);
      });
    } else {
      const og = document.createElement("optgroup");
      og.label = groupName;
      items.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.label;
        og.appendChild(opt);
      });
      sel.appendChild(og);
    }
  }
}

function valuesAt(entityId, year) {
  const ts = state.timeseries.data[entityId];
  const years = state.timeseries.years;
  const idx = years.indexOf(year);
  if (!ts || idx < 0) return {};
  const tfr = ts.tfr?.[idx] ?? null;
  const e0 = ts.e0?.[idx] ?? null;
  const g = ts.growth_rate?.[idx];
  const n = ts.natural_rate?.[idx];
  const mig = (g != null && n != null) ? (g - n) * 10 : null;
  return { tfr, e0, netMigPer1000: mig };
}

function pickAsfrPatternForE0(e0) {
  if (e0 == null) return "mid";
  if (e0 >= 78) return "late";
  if (e0 >= 70) return "mid";
  return "early";
}

function latestForEntity(entityId, key) {
  const ts = state.timeseries?.data?.[entityId];
  if (!ts) return null;
  const arr = ts[key];
  if (!arr) return null;
  const years = state.timeseries.years;
  for (let y = 2024; y >= 1950; y--) {
    const i = years.indexOf(y);
    if (i >= 0 && arr[i] != null) return arr[i];
  }
  return null;
}

function netMigPer1000ForEntity(entityId) {
  const g = latestForEntity(entityId, "growth_rate");
  const n = latestForEntity(entityId, "natural_rate");
  if (g == null || n == null) return null;
  // Both per 100; convert to per 1000.
  return (g - n) * 10;
}

function applyValuesToSliders({ tfr, e0, netMigPer1000, asfrPattern }) {
  const tfrEl = document.getElementById("tfr-slider");
  const e0El = document.getElementById("e0-slider");
  const migEl = document.getElementById("mig-slider");
  const patEl = document.getElementById("asfr-pattern");
  if (tfr != null) {
    const v = Math.max(0.5, Math.min(12.0, Math.round(tfr * 20) / 20));
    tfrEl.value = v;
    state.scenario.tfr = v;
    document.getElementById("tfr-val").textContent = v.toFixed(2);
  }
  if (e0 != null) {
    const v = Math.max(20, Math.min(200, Math.round(e0 * 2) / 2));
    e0El.value = v;
    state.scenario.e0 = v;
    document.getElementById("e0-val").textContent = v.toFixed(1);
  }
  if (netMigPer1000 != null) {
    const v = Math.max(-20, Math.min(50, Math.round(netMigPer1000 * 2) / 2));
    migEl.value = v;
    state.scenario.netMigPer1000 = v;
    document.getElementById("mig-val").textContent = v.toFixed(1);
  }
  if (asfrPattern) {
    patEl.value = asfrPattern;
    state.scenario.asfrPattern = asfrPattern;
  }
}

function applyPreset(id) {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return;

  const switchEntity = (entityId) => {
    if (!state.selected.includes(entityId)) {
      if (state.selected.length >= 8) state.selected.shift();
      state.selected.push(entityId);
    }
    state.scenarioEntity = entityId;
    renderSelectedChips();
    renderScenarioEntityOptions();
  };

  if (preset.type === "snapshot") {
    switchEntity(preset.entity);
    const tfr = latestForEntity(preset.entity, "tfr");
    const e0 = latestForEntity(preset.entity, "e0");
    const mig = netMigPer1000ForEntity(preset.entity);
    applyValuesToSliders({
      tfr, e0,
      netMigPer1000: mig != null ? mig : 0,
      asfrPattern: pickAsfrPatternForE0(e0),
    });
  } else if (preset.type === "historical") {
    switchEntity(preset.entity);
    const v = valuesAt(preset.entity, preset.year);
    applyValuesToSliders({
      tfr: v.tfr,
      e0: v.e0,
      netMigPer1000: v.netMigPer1000 ?? 0,
      asfrPattern: pickAsfrPatternForE0(v.e0),
    });
  } else if (preset.type === "values") {
    applyValuesToSliders(preset.values);
  } else if (preset.type === "reset") {
    state.selected = ["United States"].filter((eid) => state.entities.some((e) => e.id === eid));
    if (state.selected.length === 0) state.selected = state.featured.slice(0, 1);
    state.scenarioEntity = state.selected[0];
    const tfr = latestForEntity("United States", "tfr");
    const e0 = latestForEntity("United States", "e0");
    const mig = netMigPer1000ForEntity("United States");
    applyValuesToSliders({
      tfr, e0,
      netMigPer1000: mig != null ? mig : 0,
      asfrPattern: pickAsfrPatternForE0(e0),
    });
    renderSelectedChips();
    renderScenarioEntityOptions();
  }

  // Always show the scenario after a preset is applied
  state.scenarioOn = true;
  document.getElementById("scenario-on").checked = true;

  refreshAllCharts();
}

// ---------- custom CSV import ----------

const TEMPLATE_CSV = `age_group,population
0_4,1000000
5_9,1000000
10_14,1000000
15_19,1000000
20_24,1100000
25_29,1100000
30_34,1100000
35_39,1100000
40_44,1000000
45_49,1000000
50_54,900000
55_59,800000
60_64,700000
65_69,600000
70_74,500000
75_79,400000
80_84,250000
85_89,150000
90_94,60000
95_99,15000
100plus,2000`;

function parseCustomCsv(text) {
  const expected = state.standards.age_groups;
  const lines = text.trim().split(/\r?\n/);
  const start = lines[0].toLowerCase().includes("age") ? 1 : 0;
  const map = {};
  for (let i = start; i < lines.length; i++) {
    const [g, v] = lines[i].split(",").map((s) => s.trim());
    if (!g) continue;
    const num = Number(v);
    if (!isFinite(num) || num < 0) {
      throw new Error(`Bad value at row ${i + 1}: "${v}"`);
    }
    map[g] = num;
  }
  const pop = expected.map((g) => {
    if (!(g in map)) throw new Error(`Missing age group "${g}"`);
    return map[g];
  });
  return pop;
}

function loadCustomSeed() {
  const text = document.getElementById("custom-csv").value;
  const name = document.getElementById("custom-name").value || "My scenario";
  const year = parseInt(document.getElementById("custom-year").value, 10) || 2025;
  const msg = document.getElementById("custom-msg");
  try {
    const pop = parseCustomCsv(text);
    state.customSeed = { id: CUSTOM_ID, name, year, pop };
    if (!state.selected.includes(CUSTOM_ID)) {
      state.selected.push(CUSTOM_ID);
      renderSelectedChips();
    }
    state.scenarioEntity = CUSTOM_ID;
    renderScenarioEntityOptions();
    msg.textContent = `Loaded ${pop.length} age groups, total = ${(pop.reduce((a, b) => a + b, 0) / 1e6).toFixed(2)} M people.`;
    msg.className = "muted success";
    refreshAllCharts();
  } catch (err) {
    msg.textContent = `Error: ${err.message}`;
    msg.className = "muted error";
  }
}

// ---------- event wiring ----------

function wireEvents() {
  const search = document.getElementById("entity-search");
  const select = document.getElementById("entity-select");
  search.addEventListener("input", () => renderEntityList(search.value));

  document.getElementById("add-entity").addEventListener("click", () => {
    const v = select.value;
    if (v && !state.selected.includes(v)) {
      if (state.selected.length >= 8) state.selected.shift();
      state.selected.push(v);
      renderSelectedChips();
      renderScenarioEntityOptions();
      refreshAllCharts();
    }
  });
  select.addEventListener("dblclick", () => document.getElementById("add-entity").click());

  document.getElementById("clear-entities").addEventListener("click", () => {
    state.selected = [];
    renderSelectedChips();
    renderScenarioEntityOptions();
    refreshAllCharts();
  });

  document.getElementById("scenario-entity").addEventListener("change", (e) => {
    state.scenarioEntity = e.target.value;
    refreshAllCharts();
  });
  document.getElementById("scenario-on").addEventListener("change", (e) => {
    state.scenarioOn = e.target.checked;
    refreshAllCharts();
  });

  const tfr = document.getElementById("tfr-slider");
  const e0 = document.getElementById("e0-slider");
  const mig = document.getElementById("mig-slider");
  const pat = document.getElementById("asfr-pattern");
  const endYear = document.getElementById("proj-end");

  function syncSliders() {
    state.scenario.tfr = parseFloat(tfr.value);
    state.scenario.e0 = parseFloat(e0.value);
    state.scenario.netMigPer1000 = parseFloat(mig.value);
    state.scenario.asfrPattern = pat.value;
    state.scenario.endYear = parseInt(endYear.value, 10);
    document.getElementById("tfr-val").textContent = state.scenario.tfr.toFixed(2);
    document.getElementById("e0-val").textContent = state.scenario.e0.toFixed(1);
    document.getElementById("mig-val").textContent = state.scenario.netMigPer1000.toFixed(1);
    // Always refresh — even when the scenario overlay is off, the pyramid year line
    // on the dep/driver charts and the pyramid bars themselves track the slider state.
    refreshAllCharts();
  }
  [tfr, e0, mig, pat, endYear].forEach((el) => el.addEventListener("input", syncSliders));

  document.getElementById("preset-select").addEventListener("change", (ev) => {
    const id = ev.target.value;
    if (!id) return;
    applyPreset(id);
    // Reset the dropdown back to placeholder so the same preset can be re-applied
    ev.target.value = "";
  });

  // Modal open buttons in the top nav
  document.querySelectorAll("[data-open-dialog]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.openDialog;
      const dlg = document.getElementById(id);
      if (dlg && typeof dlg.showModal === "function") dlg.showModal();
    });
  });

  document.getElementById("custom-load").addEventListener("click", loadCustomSeed);
  document.getElementById("custom-template").addEventListener("click", () => {
    document.getElementById("custom-csv").value = TEMPLATE_CSV;
  });
  document.getElementById("custom-file").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    document.getElementById("custom-csv").value = text;
  });

  // Auto-enable scenario when sliders change for the first time
  [tfr, e0, mig, pat].forEach((el) => {
    el.addEventListener("input", () => {
      const cb = document.getElementById("scenario-on");
      if (!cb.checked) {
        cb.checked = true;
        state.scenarioOn = true;
        refreshAllCharts();
      }
    });
  });
}

// ---------- bootstrap ----------

(async function main() {
  try {
    await loadData();
    // Default selection: United States only — keeps the chart clean and pairs with
    // an auto-enabled custom scenario seeded with USA's latest known values.
    state.selected = ["United States"].filter((id) =>
      state.entities.some((e) => e.id === id)
    );
    if (state.selected.length === 0) state.selected = state.featured.slice(0, 1);
    state.scenarioEntity = state.selected[0];

    renderEntityList();
    renderSelectedChips();
    renderScenarioEntityOptions();
    renderPresets();

    // Seed scenario sliders from the most recent known values for the scenario entity.
    // For TFR and e0 we look back from 2024 to find the latest non-null estimate.
    // For net migration we derive it from (growth rate − natural change rate) × 10.
    const firstId = state.scenarioEntity;
    if (firstId && state.timeseries.data[firstId]) {
      const ts = state.timeseries.data[firstId];
      const years = state.timeseries.years;

      const latestNonNull = (arr) => {
        if (!arr) return null;
        // Look back from 2024 to find the latest known estimate (skip projections).
        for (let y = 2024; y >= 1950; y--) {
          const idx = years.indexOf(y);
          if (idx >= 0 && arr[idx] != null) return { year: y, value: arr[idx] };
        }
        return null;
      };

      const tfrLatest = latestNonNull(ts.tfr);
      const e0Latest = latestNonNull(ts.e0);
      const growthLatest = latestNonNull(ts.growth_rate);
      const naturalLatest = latestNonNull(ts.natural_rate);

      if (tfrLatest) {
        document.getElementById("tfr-slider").value = tfrLatest.value;
        state.scenario.tfr = tfrLatest.value;
        document.getElementById("tfr-val").textContent = tfrLatest.value.toFixed(2);
      }
      if (e0Latest) {
        document.getElementById("e0-slider").value = e0Latest.value;
        state.scenario.e0 = e0Latest.value;
        document.getElementById("e0-val").textContent = e0Latest.value.toFixed(1);
      }
      if (growthLatest && naturalLatest) {
        // Both rates are reported per 100. Convert to per 1000 for the migration slider.
        const migPer1000 = (growthLatest.value - naturalLatest.value) * 10;
        // Round to one decimal (slider step is 0.5; clamp to slider range)
        const clamped = Math.max(-20, Math.min(50, Math.round(migPer1000 * 2) / 2));
        document.getElementById("mig-slider").value = clamped;
        state.scenario.netMigPer1000 = clamped;
        document.getElementById("mig-val").textContent = clamped.toFixed(1);
      }

      // Pick a reasonable ASFR pattern for a developed country starting state
      // (the seed entity drives the default). Late peak for high-income, mid otherwise.
      // Heuristic: e0 >= 78 → late, else mid.
      if (e0Latest && e0Latest.value >= 78) {
        document.getElementById("asfr-pattern").value = "late";
        state.scenario.asfrPattern = "late";
      }
    }

    // Auto-enable the custom scenario so the dashed projection is visible on first load.
    state.scenarioOn = true;
    document.getElementById("scenario-on").checked = true;

    Chart.defaults.color = "#cdd6e0";
    Chart.defaults.font.family = "system-ui, -apple-system, sans-serif";
    Chart.register(window["chartjs-plugin-annotation"]);
    makeDepChart();
    makeDriverChart();
    makePyramidChart();
    refreshPyramidStats();

    wireEvents();
    document.getElementById("loading").classList.add("hidden");
  } catch (err) {
    console.error(err);
    document.getElementById("loading").textContent = `Error loading data: ${err.message}`;
  }
})();
