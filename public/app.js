import { project, dependencyRatio, setStandards } from "./projection.js";

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

const REFERENCE_LINES = [
  { y: 50, label: "50" },
  { y: 65, label: "65 — France today" },
  { y: 80, label: "80 — China 1970s" },
  { y: 128, label: "128 — China 2100" },
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
  showBands: true,
  splitYoungOld: false,
  logPop: false,
  scenario: { tfr: 2.1, e0: 80, netMigPer1000: 0, asfrPattern: "mid", endYear: 2100 },
  charts: { dep: null, driver: null, pyramid: null },
};

const CUSTOM_ID = "__custom__";

// ---------- data load ----------

async function fetchJson(url) {
  const r = await fetch(url, { cache: "force-cache" });
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

function annotationsForBands() {
  const ann = {};
  if (state.showBands) {
    REFERENCE_BANDS.forEach((b, i) => {
      ann[`b${i}`] = {
        type: "box",
        yMin: b.y0, yMax: b.y1,
        backgroundColor: b.color,
        borderWidth: 0,
      };
    });
  }
  REFERENCE_LINES.forEach((l, i) => {
    ann[`l${i}`] = {
      type: "line",
      yMin: l.y, yMax: l.y,
      borderColor: "rgba(255,255,255,0.18)",
      borderWidth: 1,
      borderDash: [3, 3],
      label: { content: l.label, display: true, position: "end", backgroundColor: "rgba(0,0,0,0.55)", color: "#bbb", font: { size: 10 } },
    };
  });
  return ann;
}

function buildDepDatasets() {
  const datasets = [];
  state.selected.forEach((id, i) => {
    const e = ent(id);
    if (!e) return;
    const color = PALETTE[i % PALETTE.length];
    if (id === CUSTOM_ID) return; // custom handled by scenario overlay
    if (state.splitYoungOld) {
      const y = getBaselineSeries(id, "dep_young");
      const o = getBaselineSeries(id, "dep_old");
      if (y) datasets.push({ label: `${e.name} — youth`, data: y, borderColor: color, backgroundColor: color + "20", borderDash: [5, 3], borderWidth: 1.5, pointRadius: 0, tension: 0.2 });
      if (o) datasets.push({ label: `${e.name} — old age`, data: o, borderColor: color, backgroundColor: color + "20", borderDash: [], borderWidth: 1.5, pointRadius: 0, tension: 0.2 });
    } else {
      const t = getBaselineSeries(id, "dep_total");
      if (t) datasets.push({ label: e.name, data: t, borderColor: color, backgroundColor: color + "20", borderWidth: 2, pointRadius: 0, tension: 0.2 });
    }
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
    if (tfr) datasets.push({ label: `${e.name} — TFR`, data: tfr, borderColor: color, borderWidth: 2, pointRadius: 0, yAxisID: "y", tension: 0.2 });
    if (e0) datasets.push({ label: `${e.name} — Life exp.`, data: e0, borderColor: color, borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, yAxisID: "y1", tension: 0.2 });
  });
  return datasets;
}

function buildPyramidDatasets() {
  if (!state.scenarioEntity) return { labels: [], datasets: [] };
  const id = state.scenarioEntity;
  let seed, label;
  if (id === CUSTOM_ID) {
    if (!state.customSeed) return { labels: [], datasets: [] };
    seed = state.customSeed.pop;
    label = `${state.customSeed.name} ${state.customSeed.year}`;
  } else {
    const s = state.ageSeed[id];
    if (!s) return { labels: [], datasets: [] };
    seed = s.pop;
    label = `${ent(id).name} ${s.year}`;
  }
  const proj = buildScenarioProjection();
  const endStep = proj ? proj[proj.length - 1] : null;
  const labels = state.standards.age_groups.map((g) => g.replace("_", "–").replace("plus", "+"));
  const ds = [
    { label, data: seed.map((v) => v / 1e6), backgroundColor: "rgba(88,166,255,0.55)", borderColor: "#58a6ff", borderWidth: 1 },
  ];
  if (endStep) {
    ds.push({
      label: `Scenario ${endStep.year}`,
      data: endStep.pop.map((v) => v / 1e6),
      backgroundColor: "rgba(249,117,131,0.55)",
      borderColor: "#f97583",
      borderWidth: 1,
    });
  }
  return { labels, datasets: ds };
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
        annotation: { annotations: annotationsForBands() },
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
          min: 20, max: 150,
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
      },
      scales: {
        x: { type: "linear", min: 1950, max: 2100, ticks: { color: "#8b949e", stepSize: 25 }, grid: { color: "#21262d" } },
        y: {
          position: "left",
          min: 0, max: 8,
          ticks: { color: "#8b949e" },
          grid: { color: "#21262d" },
          title: { display: true, text: "TFR (children/woman)", color: "#8b949e" },
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
          type: state.logPop ? "logarithmic" : "linear",
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

function refreshAllCharts() {
  // Dep
  state.charts.dep.data.datasets = buildDepDatasets();
  state.charts.dep.options.plugins.annotation.annotations = annotationsForBands();
  state.charts.dep.update("none");

  // Driver
  state.charts.driver.data.datasets = buildDriverDatasets();
  state.charts.driver.update("none");

  // Pyramid
  const pData = buildPyramidDatasets();
  state.charts.pyramid.data.labels = pData.labels;
  state.charts.pyramid.data.datasets = pData.datasets;
  state.charts.pyramid.options.scales.x.type = state.logPop ? "logarithmic" : "linear";
  state.charts.pyramid.update("none");
}

// ---------- presets ----------

function applyPreset(name) {
  const sliders = {
    tfr: document.getElementById("tfr-slider"),
    e0: document.getElementById("e0-slider"),
    mig: document.getElementById("mig-slider"),
    pat: document.getElementById("asfr-pattern"),
  };
  switch (name) {
    case "replacement":
      sliders.tfr.value = 2.10; sliders.e0.value = 80; sliders.mig.value = 0; sliders.pat.value = "mid"; break;
    case "japan-trend":
      sliders.tfr.value = 1.30; sliders.e0.value = 85; sliders.mig.value = 1; sliders.pat.value = "late"; break;
    case "china-2100":
      sliders.tfr.value = 1.10; sliders.e0.value = 84; sliders.mig.value = -0.5; sliders.pat.value = "late"; break;
    case "immigration":
      sliders.tfr.value = 1.60; sliders.e0.value = 82; sliders.mig.value = 6; sliders.pat.value = "late"; break;
    case "reset":
      sliders.tfr.value = 2.10; sliders.e0.value = 80; sliders.mig.value = 0; sliders.pat.value = "mid"; break;
  }
  ["tfr", "e0", "mig", "pat"].forEach((k) => sliders[k].dispatchEvent(new Event("input")));
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

  document.getElementById("show-bands").addEventListener("change", (e) => {
    state.showBands = e.target.checked;
    refreshAllCharts();
  });
  document.getElementById("split-young-old").addEventListener("change", (e) => {
    state.splitYoungOld = e.target.checked;
    refreshAllCharts();
  });
  document.getElementById("log-pop").addEventListener("change", (e) => {
    state.logPop = e.target.checked;
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
    if (state.scenarioOn) refreshAllCharts();
    else {
      // pyramid still depends on scenario when scenario entity is custom; refresh light
      const pData = buildPyramidDatasets();
      state.charts.pyramid.data.labels = pData.labels;
      state.charts.pyramid.data.datasets = pData.datasets;
      state.charts.pyramid.update("none");
    }
  }
  [tfr, e0, mig, pat, endYear].forEach((el) => el.addEventListener("input", syncSliders));

  document.querySelectorAll("button.preset").forEach((b) => {
    b.addEventListener("click", () => applyPreset(b.dataset.preset));
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
    // Default selection: World + China + Japan + USA
    state.selected = ["World", "China", "Japan", "United States"].filter((id) =>
      state.entities.some((e) => e.id === id)
    );
    if (state.selected.length === 0) state.selected = state.featured.slice(0, 4);
    state.scenarioEntity = state.selected[0];

    renderEntityList();
    renderSelectedChips();
    renderScenarioEntityOptions();

    // Init scenario sliders to match the first selected country's recent values if available
    const firstId = state.scenarioEntity;
    if (firstId && state.timeseries.data[firstId]) {
      const yIdx = state.timeseries.years.indexOf(2023);
      const tfrCur = state.timeseries.data[firstId].tfr?.[yIdx];
      const e0Cur = state.timeseries.data[firstId].e0?.[yIdx];
      if (tfrCur != null) {
        document.getElementById("tfr-slider").value = tfrCur;
        state.scenario.tfr = tfrCur;
        document.getElementById("tfr-val").textContent = tfrCur.toFixed(2);
      }
      if (e0Cur != null) {
        document.getElementById("e0-slider").value = e0Cur;
        state.scenario.e0 = e0Cur;
        document.getElementById("e0-val").textContent = e0Cur.toFixed(1);
      }
    }

    Chart.defaults.color = "#cdd6e0";
    Chart.defaults.font.family = "system-ui, -apple-system, sans-serif";
    Chart.register(window["chartjs-plugin-annotation"]);
    makeDepChart();
    makeDriverChart();
    makePyramidChart();

    wireEvents();
    document.getElementById("loading").classList.add("hidden");
  } catch (err) {
    console.error(err);
    document.getElementById("loading").textContent = `Error loading data: ${err.message}`;
  }
})();
