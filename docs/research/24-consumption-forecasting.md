# 24 - Lightweight consumption forecasting for a household pantry

Status: research note, 2026-11-10. Scope: on-device TypeScript (no ML dependency), with a server-side SQL sketch for notifications.

Legend: items marked **UNVERIFIED** are engineering defaults or claims I could not check against a primary source in this pass. Every default below is a starting point to calibrate on synthetic and real ledgers.

---

## 1. Recommendation (TL;DR)

1. **Model the household as a stock-exposed withdrawal process, not as a period series.** Each `consume` movement is an event; time spent with stock > 0 is the exposure. The rate is `events / in-stock time`, with exponential decay on old events (half-life 30 days) and Gamma shrinkage toward a category prior when history is thin.
2. **Days of cover** = stock / rate. **Run-out date** = now + days of cover, reported as an 80% band.
3. **Running low** = (stock <= minimum) OR (days of cover <= lead time + 2 days), with hysteresis: once flagged, stays flagged until stock reaches max(min + 1, 50% of usual).
4. **Shopping cadence** = median gap between restock sessions (sessions = purchases merged within 6 h). Next trip = earlier of (last trip + median gap) and the date the 3rd item is predicted to run out.
5. **Suggested list** = items flagged low, or predicted to run out before the trip after next; quantity = usual level minus stock; ordered by days from trip to run-out.
6. **Do not use Croston / SBA / TSB as the primary model.** They are designed for fixed-period demand with many zero periods. Keep them as a benchmark in the synthetic evaluation (Section 9) and as a fallback only if daily bucketing is adopted later.

Default values: window 90 days, half-life 30 days, prior strength 14 weighted days, safety 2 days, default lead time 2 days, minimum = max(1, ceil(25% of usual)), clear level = max(min+1, ceil(50% of usual)), restock session merge 6 h, critical count 3, default trip gap 7 days when no cadence exists.

---

## 2. Why household consumption is sparse and intermittent

- A household withdraws a few units per product per week at most, and many products sit untouched for weeks. The daily series for one product is mostly zeros (intermittent demand in the forecasting sense, see Syntetos, Boylan and Croston's classification of demand by average inter-demand interval ADI and squared coefficient of variation CV^2; the cut-offs ADI 1.32 and CV^2 0.49 quoted by vendors are **UNVERIFIED** against the original paper).
- Withdrawals are lumpy: a multipack (6 yogurts) is opened one unit at a time, but may be logged as one bulk removal. The per-event quantity is not independent of the event timing.
- Demand is censored by stock: when stock is 0 the household cannot consume, so zero consumption does not mean zero demand. Averaging over calendar days therefore underestimates the rate of any item that runs out regularly. This is the single most important point for the model choice.
- Recording is human: corrections, recounts and forgotten withdrawals create artificial events.

Consequence: the natural unit of observation is an event in continuous time with an exposure denominator, which is a Poisson-type rate estimate. The classical intermittent-demand methods assume fixed periods and do not handle stock censoring.

Sources:
- Petropoulos et al., "Forecasting: theory and practice" (review of intermittent-demand methods), https://arxiv.org/pdf/2012.03854 (found via search; abstract-level reading only).
- Syntetos, Boylan, Croston, "On the categorization of demand patterns" (2005), original ADI/CV^2 classes: **UNVERIFIED**, not opened.

---

## 3. Candidate methods (what each is good for here)

### 3.1 Simple moving average over a window
`rate = (units consumed in last W days) / W`. Simple, explainable, but treats stock-out days as zero demand and has a cliff when old events leave the window. Keep as a sanity baseline only.

### 3.2 Exponentially weighted rate (chosen core)
Weight each event by `w(t) = exp(-lambda * age_days)`, `lambda = ln2 / halfLife`. Exposure is integrated with the same weight, so the ratio is a weighted rate per in-stock day:

```
Q = sum_events  q_i * w(t_i)
E = integral over in-stock time of w(t) dt          (in days, see section 6)
rawRate = Q / E
```

Simple exponential smoothing (SES) is the same idea applied to a period series. The textbook form is: forecast `yhat_{t+h|t} = l_t`, level `l_t = alpha*y_t + (1-alpha)*l_{t-1}`, `0 <= alpha <= 1`, with flat forecasts for all horizons (Hyndman and Athanasopoulos, FPP3, section on simple exponential smoothing). Our `rawRate` is the continuous-time, exposure-normalised analogue of that level.

Source: https://otexts.com/fpp3/ses.html (fetched; equations as quoted above).

### 3.3 Croston, SBA, TSB (intermittent demand, benchmark only)
- **Croston (1972)**: separately smooths demand size z and inter-demand interval p after each non-zero period; forecast = z/p. **Known positive bias** (Syntetos and Boylan 2001, 2005).
- **SBA (Syntetos and Boylan, 2005)**: Croston multiplied by `(1 - alpha/2)` where alpha is the smoothing constant of the interval (notation varies by source). It is an approximate bias correction; some vendor pages claim it is exact, which I did not find supported. Source: https://www.research.lancs.ac.uk/portal/en/publications/on-the-bias-of-crostons-forecasting-method(034ef4e0-e772-47fd-ba73-c20821ea4993).html (record only). Factor and bias wording also cross-checked in Petropoulos (2016), https://eprints.lancs.ac.uk/79130/1/Petropoulos_2016_another_look_at_estimators_for_intermittent_demand.pdf (search snippet only).
- **TSB (Teunter, Syntetos, Babai, 2011)**: smooths demand probability every period instead of the interval, so a stopped item decays to zero. Designed for obsolescence. Source: European Journal of Operational Research 214(3):606-615, DOI 10.1016/j.ejor.2011.05.018, https://dx.doi.org/10.1016/j.ejor.2011.05.018 (metadata and abstract read; full text paywalled). Follow-up on real military and automotive data: Babai, Syntetos, Teunter (2014), International Journal of Production Economics, https://orca.cardiff.ac.uk/id/eprint/73482/1/2%20Babai%20et%20al%20%282014%20-%20IJPE%29.pdf.
- Why not primary: they need a fixed period and treat each period as a demand draw. A daily bucket of a household item is almost always zero, and stock-outs are indistinguishable from low demand. Their probability-of-demand components do not model stock censoring. TSB's obsolescence handling is useful; we get the same effect from exponential decay of the rate.

### 3.4 Inter-purchase interval (restock cadence)
Median gap between restock sessions is robust to outliers (vendor and patent practice: last purchase plus median gap, sometimes minus a standard deviation; see patent US 11176588, https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11176588, and Synerise repeat-purchase guide, https://hub.synerise.com/use-cases/repetitive-purchases). Used here for the shopping cadence, not for item consumption.

### 3.5 Bayesian shrinkage toward a category prior (chosen)
Gamma-Poisson conjugacy: if events are Poisson with rate lambda per in-stock day and lambda has a Gamma(a0, b0) prior (mean a0/b0), the posterior after data Q (counts) over exposure E is Gamma(a0 + Q, b0 + E), with mean `(a0 + Q)/(b0 + E)`. We set `a0 = priorRate * k`, `b0 = k`, so the prior acts like k days of pseudo-exposure at the category rate. Standard result (Gelman et al., Bayesian Data Analysis, Gamma-Poisson), **UNVERIFIED** against a fetched page in this pass.

Hierarchical shrinkage across items is the same idea with the category as the group. A recent preprint, TSB-HB (arXiv 2511.12749, Nov 2025, https://arxiv.org/html/2511.12749v1), applies hierarchical priors across items to TSB; its reported accuracy gains are **UNVERIFIED** (preprint, not replicated).

### 3.6 Method choice summary

| Need | Method |
|---|---|
| Rate for an item with history | Exposure-weighted exponential rate (3.2) |
| Rate for a new or sparse item | Gamma shrinkage toward category prior (3.5) |
| Item stopped being used | Same decay: rate drifts to ~0 over ~2 half-lives |
| Next shopping trip | Median gap of restock sessions (3.4) |
| Benchmark only | Croston, SBA, TSB on daily buckets (3.3) |

---

## 4. Formulas

Notation: times in days, `now` = current time, window `W = 90`, half-life `H = 30`, `lambda = ln2 / H`.

```
w(t)      = exp(-lambda * (now - t))                       (t in days)
Q         = sum_{consume events i in window} min(q_i, cap) * w(t_i)
E         = sum over segments [a,b] in window with stock > 0 of
            (w(b) - w(a)) / lambda                          (w(b) > w(a) since b is later; days)
rate      = (a0 + Q) / (b0 + E),   a0 = priorRate * k,  b0 = k
shape     = a0 + Q                                          (Gamma shape; used for uncertainty)
cover     = stock / rate                                    (days; Infinity if rate = 0)
```

Notes:
- `cap` (event cap, default = usual quantity) limits a single bulk withdrawal from dominating Q. Bulk removals beyond the cap are truncated, not dropped. Multipack withdrawals are logged per unit or per pack; the model is unit-agnostic as long as the pack size is consistent per product.
- `E` excludes stock-out segments, so the rate is the in-stock rate. The run-out estimate uses in-stock rate, which is the right quantity for "how long will stock last while it is present".
- Only `kind = consume` with `delta < 0` counts as demand. `purchase`, `recount` and `correction` update stock but are not demand.
- `k = 14` (weighted days). With W = 90 and H = 30, the maximum effective exposure is about `(1 - 2^-3) / lambda` = 38 weighted days, so k = 14 gives the prior roughly a quarter of the weight once an item has a full window of history. Tune on synthetic data.

**Run-out uncertainty.** `cover` is a ratio of stock to a Gamma-distributed rate. Approximating `log(1/rate)` as normal with standard deviation `sigma = 1 / sqrt(shape)` gives an 80% band:

```
median   = now + cover * 1 day
earliest = now + cover * exp(-1.2816 * sigma) days
latest   = now + cover * exp(+1.2816 * sigma) days
```

This is an approximation (log-normal, ignores weighting effects on shape and the discreteness of events). **UNVERIFIED** calibration; check the 80% coverage on synthetic data (section 9).

**Hysteresis for "running low".**

```
minQty   = user minQty ?? max(1, ceil(0.25 * usual))
clearQty = max(minQty + 1, ceil(0.5 * usual))
low      = wasLow ? (stock < clearQty)
                  : (stock <= minQty  OR  cover <= leadTime + safety)
```

Cover criterion is only used when `events >= 2`; otherwise `cover = Infinity`.

**Cadence.** Restock timestamps (purchase, delta > 0) are merged into sessions when gaps are under 6 h. With n >= 3 sessions:

```
gap_k     = start_{k+1} - start_k  (days)
cadence   = median(gap)
nextTrip  = max(lastSession + cadence, now + 1 day)
usualWeekday = mode of weekday(start_k)
confidence = high if n >= 6 and IQR(gap) <= 0.5 * cadence; medium if n >= 4; else low
```

**Next trip.** `tripAt = min(nextTrip, date of the 3rd-soonest median run-out)`. The 3rd-soonest rule means a cluster of depletions pulls the shopping trip forward. **UNVERIFIED** number 3; tune.

**Suggested list.** Include an item if it is flagged low, or `median run-out <= tripAt + cadence` (covers the trip after next). Quantity = `max(1, ceil(usual - stock))`. Order by `urgencyDays = (median run-out - tripAt) / 1 day`, ascending (negative = runs out before the trip). Dismissed items are suppressed until the next restock (`dismissedAt <= lastRestock` keeps them, otherwise they are hidden).

---

## 5. Cold start and static defaults

Before any history exists, use the category prior for the rate and the usual quantity for stock targets. These are placeholders, to be replaced by the household's own data as it accumulates (pool across households only if the app ever has multiple).

| Category | Prior rate (units/day, 2-person household) | Note |
|---|---|---|
| Milk (bottle) | 0.35 | UNVERIFIED |
| Eggs (egg) | 1.5 | UNVERIFIED |
| Bread (loaf) | 0.3 | UNVERIFIED |
| Pasta (pack) | 0.05 | UNVERIFIED |
| Rice (bag) | 0.03 | UNVERIFIED |
| Coffee (bag) | 0.1 | UNVERIFIED |
| Canned goods | 0.1 | UNVERIFIED |
| Cleaning | 0.03 | UNVERIFIED |
| Fallback | 0.1 | UNVERIFIED |

Prior strength `k = 14`. The user sets `minQty` per item; default is the rule above.

Static threshold defaults: "low when 1 left or under 25% of usual" implemented as `minQty = max(1, ceil(0.25 * usual))`, which gives 1 for usual <= 4 and 3 for usual = 12. Lead time default 2 days (**UNVERIFIED**, a typical grocery run-out buffer, no source read).

---

## 6. Presenting the uncertainty honestly

- Show a band, not a point: "vers le 18 nov." (median) with a hover or tap detail "entre le 16 et le 21 nov.".
- Use relative phrasing when the cover is short: "dans ~5 jours" when cover < 7 days; switch to a date beyond that.
- Show confidence label: "estimation fiable" (high), "estimation approximative" (medium), "pas assez d'historique" (low, prior-driven). Low confidence items use the category prior; say so.
- Never display a date to the day for items with low confidence; round to the week.
- For the suggested list, show the reason: "sera à zéro avant le prochain passage" versus "stock sous le seuil".

These are UX suggestions; no source. Keep wording in the app's copy style.

---

## 7. Handling noise

| Noise | Handling |
|---|---|
| Bulk withdrawal (removed a whole pack by mistake) | Cap per event at usual quantity (`eventCap`). |
| Correction (fixing a typo) | Kind `correction`, updates stock but not demand. |
| Inventory recount | Kind `recount`, delta = counted minus system. Updates stock, not demand. Recount with a large delta should prompt a review. |
| Stock-out (zero stock hides demand) | Exposure excludes segments with stock <= 0. Rate is in-stock rate. |
| Holidays and seasonality | Not modelled in v1. Mitigate with the 30-day half-life; add a per-category monthly multiplier later once there is more than a year of data. **UNVERIFIED** need. |
| Multipacks | Log consumption in units; the pack size is a product attribute. Mixed logging (pack vs unit) breaks the rate, so store the unit. |
| Item abandoned | Decay drives rate toward 0 within about two half-lives (60 days). |
| Restock recorded in multiple movements | Merged into one session with the 6 h rule. |
| Pantry transfers | Use paired movements (out of pantry A, into pantry B) and exclude them from demand. |

---

## 8. Where each computation runs

- **Client (live suggestions):** `consumptionRate`, `daysOfCover`, `runOutDate`, `isRunningLow`, `shoppingCadence`, `suggestNextList`. Pure functions over the local ledger. Runs on each change, a few thousand movements is well under a millisecond per item on a phone.
- **Server (notifications when no device is open):** a Postgres function over materialised per-product rates. The client writes `product_rate` after each sync; the server does the threshold check and the hysteresis transition. Scheduled with pg_cron (Supabase supports it; **UNVERIFIED** for this project) or a scheduled Edge Function.
- **Digest the evening before the trip:** the server computes `nextTrip` from the stored cadence and sends one message at the user's evening hour when `nextTrip` is tomorrow.
- **Notify once per transition:** store `is_low` in `notification_flags`; fire only on false to true. Clear when stock reaches `clearQty`.

Consistency: the SQL sketch uses the same thresholds but approximates `E` with the window length times the stock-out-adjusted fraction stored by the client. Keep the TypeScript as the reference and test both against the same synthetic ledger.

---

## 9. TypeScript module (dependency-free)

Saved as a reference implementation; it is not wired into the app.

```ts
// cellier-forecast.ts - dependency-free consumption forecasting (reference)

export const DAY_MS = 86_400_000;

export type MovementKind = 'purchase' | 'consume' | 'correction' | 'recount';

export interface Movement {
  productId: string;
  pantryId: string;
  delta: number;          // +n restock, -n withdrawal, in units
  at: number;             // epoch ms
  memberId?: string;
  kind: MovementKind;     // only 'consume' with delta < 0 is demand
}

export interface Product {
  id: string;
  category: string;
  usualQty: number;       // target stock level, units
  minQty?: number;        // user threshold; default max(1, ceil(0.25 * usual))
  leadTimeDays?: number;  // default 2
}

export interface CategoryPrior {
  ratePerDay: number;     // prior mean, units per in-stock day
  strengthDays: number;   // k, pseudo-exposure in weighted days
}

export interface Config {
  windowDays: number;     // 90
  halfLifeDays: number;   // 30
  safetyDays: number;     // 2
  criticalCount: number;  // 3
  mergeHours: number;     // 6
  eventCap?: number;      // per-event cap, usually product.usualQty
}

export const DEFAULTS: Config = {
  windowDays: 90,
  halfLifeDays: 30,
  safetyDays: 2,
  criticalCount: 3,
  mergeHours: 6,
};

export const FALLBACK_PRIOR: CategoryPrior = { ratePerDay: 0.1, strengthDays: 14 };

export interface RateEstimate {
  ratePerDay: number;          // posterior mean (shrunk)
  rawRate: number;             // Q / E, unshrunk
  shape: number;               // a0 + Q
  exposureDays: number;        // E, weighted in-stock days
  events: number;              // consume events in window
}

export function consumptionRate(
  movements: Movement[],
  now: number,
  prior: CategoryPrior,
  cfg: Config = DEFAULTS,
): RateEstimate {
  const lambda = Math.LN2 / cfg.halfLifeDays;            // decay per day
  const wAt = (t: number) => Math.exp(-lambda * (now - t) / DAY_MS);
  const start = now - cfg.windowDays * DAY_MS;
  // integral of w over [a, b] in days, clipped to the window
  const expo = (a: number, b: number) => {
    const lo = Math.max(a, start);
    const hi = Math.min(b, now);
    return hi > lo ? (wAt(hi) - wAt(lo)) / lambda : 0;
  };

  const ms = movements.filter(m => m.at <= now).sort((x, y) => x.at - y.at);
  let stock = 0;
  let prev = ms.length ? ms[0].at : now;
  let Q = 0;
  let E = 0;
  let events = 0;

  for (const m of ms) {
    if (stock > 0) E += expo(prev, m.at);
    prev = m.at;
    stock += m.delta;
    if (m.kind === 'consume' && m.delta < 0 && m.at >= start) {
      const q = Math.min(-m.delta, cfg.eventCap ?? Infinity);
      Q += q * wAt(m.at);
      events++;
    }
  }
  if (stock > 0) E += expo(prev, now);

  const a0 = prior.ratePerDay * prior.strengthDays;
  const b0 = prior.strengthDays;
  const shape = a0 + Q;
  return {
    ratePerDay: shape / (b0 + E),
    rawRate: E > 0 ? Q / E : 0,
    shape,
    exposureDays: E,
    events,
  };
}

export function daysOfCover(stock: number, ratePerDay: number): number {
  if (stock <= 0) return 0;
  return ratePerDay > 0 ? stock / ratePerDay : Infinity;
}

export interface RunOut {
  median: number;     // epoch ms
  earliest: number;   // 10th percentile (approx.)
  latest: number;     // 90th percentile (approx.)
  days: number;       // median days of cover
}

export function runOutDate(
  stock: number,
  est: RateEstimate,
  now: number,
  z = 1.2816,
): RunOut | null {
  if (est.ratePerDay <= 0) return null;
  const days = daysOfCover(stock, est.ratePerDay);
  const sigma = 1 / Math.sqrt(Math.max(est.shape, 1e-9));
  const at = (d: number) => now + d * DAY_MS;
  return {
    median: at(days),
    earliest: at(days * Math.exp(-z * sigma)),
    latest: at(days * Math.exp(z * sigma)),
    days,
  };
}

export function isRunningLow(
  stock: number,
  p: Product,
  coverDays: number,
  wasLow: boolean,
  cfg: Config = DEFAULTS,
): boolean {
  const minQty = p.minQty ?? Math.max(1, Math.ceil(0.25 * p.usualQty));
  const lead = p.leadTimeDays ?? 2;
  const clearQty = Math.max(minQty + 1, Math.ceil(0.5 * p.usualQty));
  if (wasLow) return stock < clearQty;                     // hysteresis
  return stock <= minQty || coverDays <= lead + cfg.safetyDays;
}

export interface Cadence {
  medianGapDays: number;
  usualWeekday: number;     // 0 = Sunday
  sessions: number;
  confidence: 'high' | 'medium' | 'low';
  lastSessionAt: number;
  nextAt: number;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function shoppingCadence(
  restocks: number[],
  now: number,
  cfg: Config = DEFAULTS,
): Cadence | null {
  const mergeMs = cfg.mergeHours * 3_600_000;
  const starts: number[] = [];
  let last = -Infinity;
  for (const t of [...restocks].sort((a, b) => a - b)) {
    if (t - last > mergeMs) starts.push(t);
    last = t;
  }
  if (starts.length < 3) return null;

  const gaps = starts.slice(1).map((t, i) => (t - starts[i]) / DAY_MS);
  const med = quantile(gaps, 0.5);
  const iqr = quantile(gaps, 0.75) - quantile(gaps, 0.25);

  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  for (const t of starts) weekdays[new Date(t).getDay()]++;
  const usualWeekday = weekdays.indexOf(Math.max(...weekdays));

  const confidence: Cadence['confidence'] =
    starts.length >= 6 && iqr <= 0.5 * med ? 'high' : starts.length >= 4 ? 'medium' : 'low';

  const lastSessionAt = starts[starts.length - 1];
  const nextAt = Math.max(lastSessionAt + med * DAY_MS, now + DAY_MS);
  return { medianGapDays: med, usualWeekday, sessions: starts.length, confidence, lastSessionAt, nextAt };
}

export interface HouseholdState {
  products: Product[];
  movements: Movement[];                    // full ledger, all pantries
  stock: Record<string, number>;            // materialised stock per product
  priors: Record<string, CategoryPrior>;    // per category
  lowFlags?: Record<string, boolean>;       // persisted hysteresis
  dismissedAt?: Record<string, number>;     // epoch ms of dismissal
}

export interface Suggestion {
  productId: string;
  category: string;
  qty: number;
  runOut: RunOut | null;
  urgencyDays: number;                      // (median run-out - trip) in days; < 0 = before trip
  confidence: 'high' | 'medium' | 'low';
  reason: 'running-low' | 'runs-out-before-trip';
}

export interface NextList {
  tripAt: number;
  cadence: Cadence | null;
  items: Suggestion[];
  lowNow: string[];                         // product ids currently low (diff against lowFlags to notify)
}

export function suggestNextList(s: HouseholdState, now: number, cfg: Config = DEFAULTS): NextList {
  const byProduct = new Map<string, Movement[]>();
  const restocks: number[] = [];
  for (const m of s.movements) {
    const arr = byProduct.get(m.productId) ?? [];
    arr.push(m);
    byProduct.set(m.productId, arr);
    if (m.kind === 'purchase' && m.delta > 0) restocks.push(m.at);
  }

  const cadence = shoppingCadence(restocks, now, cfg);
  const gapMs = (cadence?.medianGapDays ?? 7) * DAY_MS;

  const rows = s.products.map(p => {
    const ms = byProduct.get(p.id) ?? [];
    const prior = s.priors[p.category] ?? FALLBACK_PRIOR;
    const est = consumptionRate(ms, now, prior, { ...cfg, eventCap: p.usualQty });
    const stock = s.stock[p.id] ?? 0;
    const cover = est.events >= 2 ? daysOfCover(stock, est.ratePerDay) : Infinity;
    const ro = runOutDate(stock, est, now);
    const low = isRunningLow(stock, p, cover, s.lowFlags?.[p.id] ?? false, cfg);
    let lastRestock = -Infinity;
    for (const m of ms) if (m.kind === 'purchase' && m.delta > 0) lastRestock = Math.max(lastRestock, m.at);
    const confidence: Suggestion['confidence'] =
      est.events >= 6 && est.exposureDays >= 20 && cadence ? 'high' : est.events >= 3 ? 'medium' : 'low';
    return {
      p, stock, ro, low, confidence, lastRestock,
      dismissed: s.dismissedAt?.[p.id] ?? -Infinity,
    };
  });

  const medians = rows.map(r => r.ro?.median ?? Infinity).sort((a, b) => a - b);
  const criticalAt = medians[cfg.criticalCount - 1] ?? Infinity;
  const tripAt = Math.min(cadence?.nextAt ?? now + 7 * DAY_MS, criticalAt);
  const horizon = tripAt + gapMs;                           // trip after next

  const items: Suggestion[] = rows
    .filter(r => (r.low || (!!r.ro && r.ro.median <= horizon)) && r.dismissed <= r.lastRestock)
    .map(r => ({
      productId: r.p.id,
      category: r.p.category,
      qty: Math.max(1, Math.ceil(r.p.usualQty - r.stock)),
      runOut: r.ro,
      urgencyDays: ((r.ro?.median ?? now) - tripAt) / DAY_MS,
      confidence: r.confidence,
      reason: r.low ? 'running-low' : 'runs-out-before-trip',
    }))
    .sort((a, b) => a.urgencyDays - b.urgencyDays);

  return { tripAt, cadence, items, lowNow: rows.filter(r => r.low).map(r => r.p.id) };
}
```

Quick usage (client):

```ts
const now = Date.now();
const list = suggestNextList(state, now);
const newlyLow = list.lowNow.filter(id => !state.lowFlags?.[id]); // notify these once
state.lowFlags = Object.fromEntries(list.lowNow.map(id => [id, true]));
```

Lines to keep honest: the `lowFlags` must be recomputed for all products (not only the ones in `lowNow`) when persisting, otherwise cleared items stay flagged. Persist `Object.fromEntries(s.products.map(p => [p.id, list.lowNow.includes(p.id)]))`.

---

## 10. SQL sketch (server-side low-stock check, Postgres / Supabase)

Assumes the client writes `product_rate` after each sync (rate, shape) and maintains `stock`. Exposure-aware rate stays client-side; the server only reads it. Intervals are the same 80% band as section 4.

```sql
create table if not exists product_rate (
  product_id  text primary key,
  rate_per_day numeric not null,
  shape        numeric not null,
  updated_at   timestamptz not null default now()
);

create table if not exists notification_flags (
  product_id text primary key,
  is_low     boolean not null default false,
  notified_at timestamptz
);

create or replace function low_stock_check(p_now timestamptz default now())
returns table (
  product_id    text,
  stock         numeric,
  cover_days    numeric,
  earliest      timestamptz,
  median        timestamptz,
  latest        timestamptz,
  should_notify boolean
)
language sql
stable
as $$
  with base as (
    select p.id,
           s.qty                                                    as stock,
           p.usual_qty,
           coalesce(p.min_qty, greatest(1, ceil(0.25 * p.usual_qty))) as min_qty,
           coalesce(p.lead_time_days, 2)                            as lead,
           pr.rate_per_day,
           coalesce(pr.shape, 1e-9)                                 as shape
    from products p
    join stock s on s.product_id = p.id
    left join product_rate pr on pr.product_id = p.id
  ),
  cov as (
    select b.*,
           case when b.stock <= 0 then 0
                when b.rate_per_day > 0 then b.stock / b.rate_per_day
           end as cover_days
    from base b
  ),
  trig as (
    select c.*,
           (c.stock <= c.min_qty
            or (c.cover_days is not null and c.cover_days <= c.lead + 2)) as trigger_low
    from cov c
  ),
  hyst as (
    select t.*,
           coalesce(nf.is_low, false) as was_low,
           case when coalesce(nf.is_low, false)
                then t.stock < greatest(t.min_qty + 1, ceil(0.5 * t.usual_qty))
                else t.trigger_low
           end as is_low
    from trig t
    left join notification_flags nf on nf.product_id = t.id
  )
  select h.id,
         h.stock,
         h.cover_days,
         p_now + make_interval(secs => h.cover_days * exp(-1.2816 / sqrt(h.shape)) * 86400),
         p_now + make_interval(secs => h.cover_days * 86400),
         p_now + make_interval(secs => h.cover_days * exp( 1.2816 / sqrt(h.shape)) * 86400),
         (h.is_low and not h.was_low)
  from hyst h;
$$;

-- Scheduled job (pg_cron on Supabase, UNVERIFIED for this project):
-- select cron.schedule('low-stock-18h', '0 17 * * *',  -- 18:00 Paris in winter; adjust for DST
--   $$ insert into notification_outbox (product_id, kind, created_at)
--      select product_id, 'running_low', now() from low_stock_check() where should_notify $$);
-- After the outbox is delivered, upsert notification_flags with is_low = true (and false when cleared).
```

Note on the sketch: `cover_days` is null when no rate has been written; `should_notify` is then null and nothing fires, which is the desired cold-start behaviour unless the static minimum is hit. Replace the `0 17 * * *` schedule with the user's evening hour once the digest logic is in place.

---

## 11. Evaluation with synthetic household data

Build a generator before tuning:

1. **Household model:** 2 to 4 members; each product has a base rate per day, a weekly pattern (weekend multiplier), and a seasonal multiplier (December spike, summer dip). Use gamma-distributed inter-withdrawal times with a random pack size.
2. **Shopping behaviour:** trips with a weekday and a jittered cadence (for example Saturday with a 1 day standard deviation); each trip buys to the usual level for a random subset of items; occasionally a forgotten purchase.
3. **Noise:** 2% of withdrawals logged twice or as a bulk removal; 1 recount per month per item with a random correction; 5% of days the item is in stock-out (if the household forgot to buy it).
4. **Ground truth:** the true run-out time is known from the generator.

Metrics:

- **Run-out error:** |median - true run-out| in days, and its median over items. Target: below 2 days for items with 6+ events.
- **Band calibration:** fraction of true run-outs inside the 80% band. Target: 0.7 to 0.9. If well below, widen the band (raise sigma) and report it.
- **Low-flag quality:** precision and recall of `isRunningLow` against "stock below minimum within 3 days". Target: recall above 0.95 for the threshold part; false alarm rate per item per month low enough to be tolerable (set the number once a baseline exists).
- **Notification count:** exactly one per low transition; zero repeats between restocks (test the hysteresis).
- **Shopping date error:** days between predicted and actual trip. Target: within 1 day for high-confidence cadence.
- **Baselines:** moving average over 30 days, naive "last gap" rule, Croston and TSB on daily buckets. The exposure-aware rate should win on stock-out-heavy items; if it does not, the shrinkage or half-life is wrong.
- **Sensitivity:** half-life in {14, 30, 60}; prior strength in {7, 14, 30}; window in {60, 90, 180}; cap in {1x, 2x usual}.

Real-data check: once the app has 3 months of household ledger, compare the predicted run-outs with the next recount (recounts give a true stock reading). That is the cheapest honest validation.

---

## 12. Sources

Read or fetched:
- Hyndman and Athanasopoulos, Forecasting: Principles and Practice (FPP3), simple exponential smoothing, https://otexts.com/fpp3/ses.html (fetched; equations and initialisation quoted from the page).
- Teunter, Syntetos, Babai (2011), EJOR 214(3):606-615, https://dx.doi.org/10.1016/j.ejor.2011.05.018 (metadata and abstract only).

Found through search (abstract or snippet level, not opened):
- Petropoulos et al., Forecasting: theory and practice, https://arxiv.org/pdf/2012.03854
- Syntetos and Boylan (2005), On the bias of Croston's forecasting method, EJOR; record: https://www.research.lancs.ac.uk/portal/en/publications/on-the-bias-of-crostons-forecasting-method(034ef4e0-e772-47fd-ba73-c20821ea4993).html
- Petropoulos (2016), Another look at estimators for intermittent demand, https://eprints.lancs.ac.uk/79130/1/Petropoulos_2016_another_look_at_estimators_for_intermittent_demand.pdf
- Babai, Syntetos, Teunter (2014), IJPE, https://orca.cardiff.ac.uk/id/eprint/73482/1/2%20Babai%20et%20al%20%282014%20-%20IJPE%29.pdf
- Koehler, Hyndman, Snyder, Ord, prediction intervals for exponential smoothing via state space models (exact SES variance), https://www.econbiz.de/Record/prediction-intervals-for-exponential-smoothing-using-two-new-classes-of-state-space-models/10005635592. The SES h-step variance `sigma^2 (1 + alpha^2 (h-1))` is from memory and **UNVERIFIED**.
- TSB-HB hierarchical Bayesian TSB, arXiv 2511.12749 (preprint, Nov 2025), https://arxiv.org/html/2511.12749v1. Results **UNVERIFIED**.
- US patent 11176588, network-based inventory replenishment (median gap and standard deviation of purchase gap), https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11176588
- Synerise, repeat purchase use case (vendor), https://hub.synerise.com/use-cases/repetitive-purchases
- RUSH! (KDD 2017; authors not checked), https://data.bus.wisc.edu/papers/17-kdd-rush.pdf (interval prediction for next purchase; not read in full).

Not verified (no source opened):
- Croston (1972) original method.
- Syntetos, Boylan, Croston (2005) ADI and CV^2 cut-offs (1.32, 0.49). **UNVERIFIED**.
- Gamma-Poisson conjugacy (Gelman et al., Bayesian Data Analysis). **UNVERIFIED** as a fetched source; the algebra is standard.
- Prior grocery run-out buffer of 2 days and the category rates in section 5. **UNVERIFIED** engineering defaults.
- Supabase pg_cron availability for the project. **UNVERIFIED**.
- The 3rd-soonest-run-out trip rule and the 0.5 IQR confidence rule are design choices, not literature.

No grocery-specific engineering blog on consumption forecasting was found in this pass; the closest material is vendor and patent practice (section 3.4).
