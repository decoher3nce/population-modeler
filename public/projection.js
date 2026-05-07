// Cohort-component projection engine.
// 5-year age groups, both sexes combined, 5-year time steps.
//
// State: array of 21 age-group counts [0-4, 5-9, ..., 95-99, 100+].
// Inputs per step: { tfr, e0, netMigRate } (rate is per 1000 of total population).

const NUM_GROUPS = 21;       // 0-4, 5-9, ..., 95-99, 100+
const REPRO_START = 3;       // index of 15-19
const REPRO_END_DEFAULT = 10; // exclusive: 15-19..45-49 (indices 3..9)

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

// Convert SRB (males per 100 females) to female share of births.
// Default biological SRB ≈ 105 → female share ≈ 0.488.
function femaleShareFromSrb(srb) {
  return 100 / (100 + srb);
}

/**
 * Step the population forward by 5 years.
 *
 * pop:        length-21 array (5-year age group counts)
 * inputs:     {
 *   tfr, e0, netMigPer1000,
 *   asfrPattern?,        // "early" | "mid" | "late"
 *   srb?,                // males per 100 females at birth (default 105)
 *   reproAgeMax?,        // upper age of reproductive window (default 49)
 * }
 * returns:    { pop, births, deaths, netMigrants }
 */
export function step5(
  pop,
  {
    tfr, e0, netMigPer1000, asfrPattern: asfrName, srb, reproAgeMax,
    // Optional override: total population used to compute the absolute number
    // of migrants in this 5-year step. Defaults to sum(pop). Used by project()
    // to feed the *unshocked* baseline total so a one-shot shock event doesn't
    // cascade into reduced migration in subsequent decades.
    migrationBase,
  }
) {
  const surv = interpolateSurvival(e0);
  const survBirth = interpolateBirthSurvival(e0);
  const asfr = asfrPattern(asfrName || standards.asfr_default);
  const femaleShare = femaleShareFromSrb(srb ?? 105);

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

  // Reproductive window: indices [REPRO_START, reproEndIdx) inclusive of last fertile group.
  // reproAgeMax = 49 (default) → last fertile 5-year group is 45-49 → index 9 → reproEndIdx = 10.
  // reproAgeMax = 70 → index 13 (65-69) → reproEndIdx = 14 (capped by ASFR pattern length).
  const requestedMax = reproAgeMax ?? 49;
  const lastReproIdx = Math.min(
    NUM_GROUPS - 1,
    Math.floor(requestedMax / 5)
  );
  const reproEndIdx = Math.min(REPRO_START + asfr.length, lastReproIdx + 1);
  // Active ASFR slice + renormalisation so TFR remains the children-per-woman
  // integral over whichever window is selected.
  const activeShares = asfr.slice(0, reproEndIdx - REPRO_START);
  const sliceSum = activeShares.reduce((a, b) => a + b, 0) || 1;
  const normShares = activeShares.map((s) => s / sliceSum);

  // Births. With TFR over the active window, share[i] = fraction of TFR contributed
  // by group i. 5-year births in cohort = women[i] × TFR × share[i].
  let births5y = 0;
  for (let i = REPRO_START; i < reproEndIdx; i++) {
    const women = pop[i] * femaleShare;
    const share = normShares[i - REPRO_START];
    births5y += women * tfr * share;
  }
  // Place surviving births into 0-4 next period
  next[0] += births5y * survBirth;
  deaths += births5y * (1 - survBirth);

  // Migration: net migrants over 5 years = base × rate/1000 × 5.
  // Base defaults to the current population total. Callers (project()) can
  // override with the unshocked baseline so shocks don't drag migration down.
  const popTotal = pop.reduce((a, b) => a + b, 0);
  const baseForMig = migrationBase != null ? migrationBase : popTotal;
  const netMigrants5y = baseForMig * (netMigPer1000 / 1000) * 5;
  if (netMigrants5y !== 0) {
    const dist = standards.mig_age_dist;
    for (let i = 0; i < NUM_GROUPS; i++) {
      next[i] = Math.max(0, next[i] + netMigrants5y * dist[i]);
    }
  }

  return { pop: next, births: births5y, deaths, netMigrants: netMigrants5y };
}

/**
 * Dependency ratio with adjustable retirement-age threshold.
 * - Young = ages 0-14 (fixed).
 * - Working = ages 15..(retirementAge-1).
 * - Old = ages retirementAge..100+.
 */
export function dependencyRatio(pop, retirementAge = 65) {
  // Convert retirement age to its starting 5-year-group index.
  const oldStartIdx = Math.max(3, Math.min(NUM_GROUPS - 1, Math.floor(retirementAge / 5)));
  let young = 0, old = 0, working = 0;
  for (let i = 0; i < NUM_GROUPS; i++) {
    if (i <= 2) young += pop[i];                      // 0-14 (always young)
    else if (i < oldStartIdx) working += pop[i];      // 15..retirementAge-1
    else old += pop[i];                               // retirementAge..100+
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
 *               tfr, e0, netMigPer1000,                     // numbers (or year-functions)
 *               asfrPattern?, srb?, reproAgeMax?,
 *               retirementAge?,                             // for dependencyRatio
 *               shock?: { year, fraction }                  // one-shot population multiplier
 *             }
 *
 * Returns array of { year, pop, total, young, old, sumPop }
 */
export function project(seedPop, seedYear, endYear, scenario) {
  const out = [];
  let pop = seedPop.slice();
  // Parallel unshocked baseline. This timeline never receives the shock, and
  // its total population is used as the migration base for the actual `pop`
  // timeline so a one-shot shock doesn't bleed into subsequent decades through
  // the migration channel. Without this, a 40% old-age shock at 2030 visibly
  // reduces the 2073 0-14 and working-age cohorts by ~0.5% — non-zero, and
  // surprising for users who expect an old-age-targeted shock to leave young
  // and working-age cohorts untouched.
  let popBaseline = seedPop.slice();
  let year = seedYear;
  const retirementAge = scenario.retirementAge ?? 65;

  // Always emit the starting state
  out.push({ year, pop: pop.slice(), ...dependencyRatio(pop, retirementAge) });

  const shock = scenario.shock;
  let shockApplied = false;

  // Helper: does an age-group index belong to a shock target band?
  // 'all'      → indices 0..20
  // 'working'  → indices 3..12 (15-64)
  // 'young'    → indices 0..2 (0-14)
  // 'old'      → indices 13..20 (65+)
  const inShockTarget = (idx, target) => {
    if (!target || target === "all") return true;
    if (target === "working") return idx >= 3 && idx <= 12;
    if (target === "young") return idx <= 2;
    if (target === "old") return idx >= 13;
    return true;
  };

  // Step in 5-year periods. Normal stop: when the next step would carry past
  // endYear. Exception: if an unfired shock falls inside the [year, year+5)
  // window we're about to skip AND the shock year is itself within the user's
  // projection window, take that one extra step so the shock actually applies.
  // This keeps "endYear=2100, no shock" landing at 2098 (matching the earlier
  // off-by-five-year fix) while letting "endYear=2050, shock at 2050" still
  // fire — without that, the loop exited before 2050 was ever reached.
  while (true) {
    const wouldOvershoot = year + 5 > endYear;
    const shockInThisStep = shock && !shockApplied
      && shock.year >= year && shock.year < year + 5
      && shock.year <= endYear;
    if (wouldOvershoot && !shockInThisStep) break;

    // Apply one-shot shock at the start of the 5-year period that contains it.
    // shock.fraction is signed: positive = gain (e.g. +0.20 = 20% population
    // increase from migration/annexation), negative = loss (e.g. -0.10 = 10%
    // loss). shock.target restricts the multiplier to a subset of age groups
    // so age-skewed events (working-age pandemic, working-age refugee influx)
    // actually move the dependency ratio rather than just scaling uniformly.
    if (shockInThisStep) {
      const fraction = Math.max(-0.4, Math.min(0.4, shock.fraction || 0));
      const factor = 1 + fraction;
      const target = shock.target || "all";
      if (fraction !== 0) {
        // Shock applies to the actual `pop` only; popBaseline keeps running
        // its undisturbed timeline so it can drive migration without cascade.
        pop = pop.map((p, i) => (inShockTarget(i, target) ? p * factor : p));
      }
      shockApplied = true;
    }
    const baseInputs = {
      tfr: typeof scenario.tfr === "function" ? scenario.tfr(year) : scenario.tfr,
      e0: typeof scenario.e0 === "function" ? scenario.e0(year) : scenario.e0,
      netMigPer1000: typeof scenario.netMigPer1000 === "function"
        ? scenario.netMigPer1000(year)
        : scenario.netMigPer1000,
      asfrPattern: scenario.asfrPattern,
      srb: scenario.srb,
      reproAgeMax: scenario.reproAgeMax,
    };
    // Step the unshocked baseline first; its total feeds migrationBase for the
    // actual timeline so migration doesn't shrink when shocks reduce pop.
    const baselineTotal = popBaseline.reduce((a, b) => a + b, 0);
    const rb = step5(popBaseline, baseInputs);
    popBaseline = rb.pop;

    const r = step5(pop, { ...baseInputs, migrationBase: baselineTotal });
    pop = r.pop;
    year += 5;
    out.push({ year, pop: pop.slice(), ...dependencyRatio(pop, retirementAge) });
  }
  return out;
}

/**
 * Estimate the replacement-rate TFR for a given SRB and life-expectancy.
 * replacement = (1 + srb/100) / (girl-survival-to-childbearing)
 *
 * Girl survival proxy: surv_birth × prod_{a=0..4} surv[a] (covers 0-4..20-24).
 * In low-mortality settings this is ~0.97 → replacement ~ 2.05/0.97 = 2.11.
 * In high-mortality settings (e0=50): ~0.79 → replacement ~ 2.6.
 * Returns NaN if standards aren't loaded.
 */
export function replacementTfr(srb, e0) {
  if (!standards) return NaN;
  const surv = interpolateSurvival(e0);
  const survBirth = interpolateBirthSurvival(e0);
  // Cumulative female survival from birth through 24 (= reaching prime childbearing window).
  let girlSurv = survBirth;
  for (let i = 0; i <= 4; i++) girlSurv *= surv[i]; // 0-4→5-9, 5-9→10-14, 10-14→15-19, 15-19→20-24
  girlSurv = Math.max(girlSurv, 1e-6);
  return (1 + srb / 100) / girlSurv;
}
