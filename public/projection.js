// Cohort-component projection engine.
// 5-year age groups, both sexes combined, 5-year time steps.
//
// State: array of 21 age-group counts [0-4, 5-9, ..., 95-99, 100+].
// Inputs per step: { tfr, e0, netMigRate } (rate is per 1000 of total population).

const NUM_GROUPS = 21;       // 0-4, 5-9, ..., 95-99, 100+
const REPRO_START = 3;       // index of 15-19
const REPRO_END = 9;         // exclusive: 15-19..45-49 (indices 3..9)

let standards = null;

export function setStandards(tables) {
  standards = tables;
}

function interpolateSurvival(e0) {
  const keys = Object.keys(standards.surv_by_e0).map(Number).sort((a, b) => a - b);
  if (e0 <= keys[0]) return standards.surv_by_e0[keys[0]];
  if (e0 >= keys[keys.length - 1]) return standards.surv_by_e0[keys[keys.length - 1]];
  let lo = keys[0], hi = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (e0 >= keys[i] && e0 <= keys[i + 1]) {
      lo = keys[i]; hi = keys[i + 1]; break;
    }
  }
  const f = (e0 - lo) / (hi - lo);
  const sLo = standards.surv_by_e0[lo];
  const sHi = standards.surv_by_e0[hi];
  return sLo.map((v, i) => v + f * (sHi[i] - v));
}

function interpolateBirthSurvival(e0) {
  const keys = Object.keys(standards.surv_birth_by_e0).map(Number).sort((a, b) => a - b);
  if (e0 <= keys[0]) return standards.surv_birth_by_e0[keys[0]];
  if (e0 >= keys[keys.length - 1]) return standards.surv_birth_by_e0[keys[keys.length - 1]];
  let lo = keys[0], hi = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (e0 >= keys[i] && e0 <= keys[i + 1]) {
      lo = keys[i]; hi = keys[i + 1]; break;
    }
  }
  const f = (e0 - lo) / (hi - lo);
  return standards.surv_birth_by_e0[lo] + f * (standards.surv_birth_by_e0[hi] - standards.surv_birth_by_e0[lo]);
}

function asfrPattern(name) {
  return standards.asfr_patterns[name] || standards.asfr_patterns[standards.asfr_default];
}

/**
 * Step the population forward by 5 years.
 *
 * pop:        length-21 array (5-year age group counts)
 * inputs:     { tfr, e0, netMigPer1000, asfrPattern? }
 * returns:    { pop, births, deaths, netMigrants }
 */
export function step5(pop, { tfr, e0, netMigPer1000, asfrPattern: asfrName }) {
  const surv = interpolateSurvival(e0);
  const survBirth = interpolateBirthSurvival(e0);
  const asfr = asfrPattern(asfrName || standards.asfr_default);
  const womenShare = standards.women_share;

  const next = new Array(NUM_GROUPS).fill(0);
  let deaths = 0;

  // Age survivors forward
  for (let i = 0; i < NUM_GROUPS - 1; i++) {
    const survived = pop[i] * surv[i];
    next[i + 1] += survived;
    deaths += pop[i] - survived;
  }
  // Open-ended group 100+: existing 100+ have very low survival.
  // surv has 20 entries (one per inter-group transition); the last entry is 95-99→100+.
  // For 100+ → 100+ over 5 years, use that last entry shrunk by another decade of mortality.
  const openSurv = surv[NUM_GROUPS - 2] * 0.5;
  next[NUM_GROUPS - 1] += pop[NUM_GROUPS - 1] * openSurv;
  deaths += pop[NUM_GROUPS - 1] * (1 - openSurv);

  // Births. ASFR pattern shares are over the 5-year reproductive groups.
  // Total annual births ≈ Σ (women[a] × ASFR[a]).
  // With TFR = Σ ASFR[a] × 5 (over 7 5-year groups), and pattern shares p[i] (sum=1),
  // ASFR[a] in 5-year units = TFR × p[i] / 5  → annual births in cohort = women[a] × TFR × p[i] / 5
  // Over 5 years: women[a] × TFR × p[i].
  let births5y = 0;
  for (let i = REPRO_START; i < REPRO_END; i++) {
    const women = pop[i] * womenShare;
    const share = asfr[i - REPRO_START];
    births5y += women * tfr * share;
  }
  // Place surviving births into 0-4 next period
  next[0] += births5y * survBirth;
  deaths += births5y * (1 - survBirth);

  // Migration: net migrants over 5 years = pop_total × rate/1000 × 5
  const popTotal = pop.reduce((a, b) => a + b, 0);
  const netMigrants5y = popTotal * (netMigPer1000 / 1000) * 5;
  if (netMigrants5y !== 0) {
    const dist = standards.mig_age_dist;
    for (let i = 0; i < NUM_GROUPS; i++) {
      next[i] = Math.max(0, next[i] + netMigrants5y * dist[i]);
    }
  }

  return { pop: next, births: births5y, deaths, netMigrants: netMigrants5y };
}

export function dependencyRatio(pop) {
  let young = 0, old = 0, working = 0;
  for (let i = 0; i < NUM_GROUPS; i++) {
    if (i <= 2) young += pop[i];           // 0-14
    else if (i <= 12) working += pop[i];   // 15-64
    else old += pop[i];                    // 65+
  }
  if (working === 0) return { total: 0, young: 0, old: 0, sumPop: young + working + old };
  return {
    total: ((young + old) / working) * 100,
    young: (young / working) * 100,
    old: (old / working) * 100,
    sumPop: young + working + old,
  };
}

/**
 * Project a population forward.
 *
 * seedPop:    21-element age-group array (the starting state, e.g. 2023)
 * seedYear:   the year of seedPop
 * endYear:    last year of projection (rounded down to nearest 5-yr step)
 * scenario:   {
 *               tfr: number | (year)=>number,
 *               e0: number | (year)=>number,
 *               netMigPer1000: number | (year)=>number,
 *               asfrPattern?: string
 *             }
 *
 * Returns array of { year, pop, depRatio, depYoung, depOld, total }
 */
export function project(seedPop, seedYear, endYear, scenario) {
  const out = [];
  // Round seedYear down to nearest 5-year boundary for clean periods.
  const startYear = seedYear - (seedYear % 5);
  let pop = seedPop.slice();
  let year = seedYear;

  // Always emit the starting state
  out.push({ year, pop: pop.slice(), ...dependencyRatio(pop) });

  // Step in 5-year periods. Stop before overshooting endYear so the final
  // data point is the last 5-year step that lies on or before endYear
  // (e.g. with seedYear=2023 and endYear=2100, the last year is 2098, not 2103).
  while (year + 5 <= endYear) {
    const inputs = {
      tfr: typeof scenario.tfr === "function" ? scenario.tfr(year) : scenario.tfr,
      e0: typeof scenario.e0 === "function" ? scenario.e0(year) : scenario.e0,
      netMigPer1000: typeof scenario.netMigPer1000 === "function"
        ? scenario.netMigPer1000(year)
        : scenario.netMigPer1000,
      asfrPattern: scenario.asfrPattern,
    };
    const r = step5(pop, inputs);
    pop = r.pop;
    year += 5;
    out.push({ year, pop: pop.slice(), ...dependencyRatio(pop) });
  }
  return out;
}
