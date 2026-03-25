# Experiment Log

## Experiment 1 — Social scoring confidence weighting
- **Hypothesis:** social score was too sensitive to small mention counts and thin sentiment samples.
- **Change:** replaced linear mention growth with log scaling; sentiment spread now gets confidence weighting from total signals; reasoning includes confidence.
- **Files:** `synthesis/scoring.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Benchmark:**
  - baseline: ETH 6.0 / SOL 5.3 / AAVE 5.7
  - after change: ETH 6.0 / SOL 5.3 / AAVE 4.0
- **Result:** kept. More conservative on sparse social data; ETH/SOL remained in range.

## Experiment 2 — Completeness from metadata collectors
- **Hypothesis:** completeness should follow `metadata.collectors.ok`, not object presence only.
- **Change:** temporarily switched completeness to metadata-driven logic.
- **Files:** `synthesis/scoring.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Benchmark:** ETH 4.3 / SOL 3.5 / AAVE 4.0
- **Result:** discarded and reverted. Penalized too aggressively for normal partial-data cases.

## Experiment 3 — Cache corruption resilience
- **Hypothesis:** malformed cached JSON should not take down alpha requests.
- **Change:** wrapped cache JSON parsing in `try/catch`; corrupted rows are deleted and treated as cache misses.
- **Files:** `routes/alpha.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Better graceful degradation with zero API changes.

## Experiment 4 — LLM output normalization hardening
- **Hypothesis:** model output can drift from schema (invalid verdict casing/spacing, duplicated bullets).
- **Change:** normalized verdicts to allowed enum values and deduplicated/trimmed array fields.
- **Files:** `synthesis/llm.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Safer downstream formatting without changing the public API.

## Experiment 5 — Social narrative cleanup + recency ordering
- **Hypothesis:** narrative extraction included noisy project tokens, and recent news should prefer newest entries first.
- **Change:** replaced the useless literal `projectName` stopword with real project token filtering; added generic token/coin stopwords; sorted `recent_news` by descending date before truncating.
- **Files:** `collectors/social.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Better signal quality and more sensible news ordering.

## Experiment 6 — Report completeness visibility
- **Hypothesis:** users should see generation time and data completeness immediately, not buried inside the overall score reasoning.
- **Change:** surfaced `generated_at` and overall completeness in the text and HTML report headers.
- **Files:** `synthesis/templates.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Better readability with no JSON/API contract changes.

## Experiment 7 — Market score adds FDV overhang + ATH distance
- **Hypothesis:** raw momentum + volume was too generous for tokens with large unlock overhang or still deeply below ATH.
- **Change:** market scoring now factors `FDV/MC` dilution risk and distance from ATH, while preserving the existing liquidity/momentum blend.
- **Files:** `synthesis/scoring.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Benchmark:** ETH 6.0 / SOL 5.2 / AAVE 4.9 (completeness 60/60/60)
- **Result:** kept. Better market-quality discrimination without breaking score ranges.

## Experiment 8 — Development score adds repo freshness + issue pressure
- **Hypothesis:** stars and commits alone miss stale repos and overloaded issue queues.
- **Change:** development scoring now considers forks, days since last commit, and a light `open_issues / commits_90d` pressure penalty.
- **Files:** `synthesis/scoring.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Benchmark:** ETH 5.1 / SOL 5.0 / AAVE 4.9 on a later live run; results were network-variable because social/tokenomics were partially unavailable, but scoring remained stable and non-breaking.
- **Result:** kept. Adds a useful maintenance-quality signal with conservative penalties.

## Experiment 9 — Social collector query expansion + article-level sentiment
- **Hypothesis:** two Exa queries under-covered catalysts/adoption narratives, and keyword totals overcounted sentiment from single noisy articles.
- **Change:** expanded Exa query set to include catalysts and adoption coverage; switched sentiment aggregation from raw keyword counts to one vote per article; dedupe key now normalizes title fallback.
- **Files:** `collectors/social.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Better data coverage and less sentiment inflation from repeated keywords.

## Experiment 10 — Onchain collector parallel discovery
- **Hypothesis:** chain detection and protocol-list discovery were serialized unnecessarily, increasing cold-start latency.
- **Change:** `collectOnchain()` now runs `tryChainTvl()` and the protocol list fetch in parallel before matching.
- **Files:** `collectors/onchain.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Small but clean latency win with no API changes.

## Experiment 11 — Data-quality summary surfaced in API/report + tokenomics slug coverage
- **Hypothesis:** users need faster visibility into partial-data conditions, and Messari lookups should try market name/symbol aliases, not only project/CoinGecko id.
- **Change:** added `data_quality` summary to alpha responses (completeness, failed collectors, latency bucket, duration), surfaced collector failures in text/HTML reports, and expanded Messari slug candidates with market `name` + `symbol`.
- **Files:** `routes/alpha.js`, `synthesis/templates.js`, `collectors/tokenomics.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Better operator visibility on degraded runs and slightly wider tokenomics lookup coverage.

## Experiment 12 — Subtle chalkboard motion + hover polish
- **Hypothesis:** the page felt static; gentle reveal/hover effects can make the chalkboard UI feel more premium without breaking the minimalist style.
- **Change:** added layered chalkboard texture, panel sheen, fade-up entrance animation, and light hover elevation for buttons/panels/cards.
- **Files:** `public/alpha.html`
- **Validation:** inline script parsed via `vm.Script`; CSS/HTML syntax stayed valid.
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. More polished visual rhythm with very low UI risk.

## Experiment 13 — Responsive report layout and mobile market board
- **Hypothesis:** the desktop-first layout compressed too hard on phones, especially verdict/header blocks and the metric table.
- **Change:** refined breakpoints, stacked major grids earlier, made verdict/header blocks mobile-friendly, and converted the market board into a readable card-like stacked table on small screens.
- **Files:** `public/alpha.html`
- **Validation:** inline script parsed via `vm.Script`; responsive CSS remained syntactically valid.
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Better mobile readability without changing the API or data model.

## Experiment 14 — Radar chart readability upgrade
- **Hypothesis:** the radar was visually on-theme but hard to read quickly; better scale cues and point styling would make scoring easier to interpret.
- **Change:** enlarged the chart slightly, added clearer grid/tick labels, endpoint dots, a center anchor, glow treatment, and stronger per-axis point markers.
- **Files:** `public/alpha.html`
- **Validation:** inline script parsed via `vm.Script`; generated SVG markup stayed valid.
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. The score radar should scan faster while preserving the chalkboard look.

## Experiment 15 — Animated score bars with clearer hierarchy
- **Hypothesis:** the score rows lacked hierarchy and felt utilitarian; adding microcopy and animated fill would improve scanability.
- **Change:** turned score rows into mini cards, added label/tone hierarchy, and animated bar fill using CSS custom properties while keeping the same score data.
- **Files:** `public/alpha.html`
- **Validation:** inline script parsed via `vm.Script`; CSS animation syntax remained valid.
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Scores now read faster and look more intentional.

## Experiment 16 — Verdict badge/cards polish + HTML report template upgrade
- **Hypothesis:** the main verdict and exported HTML report still felt more functional than premium; bringing the same design language to both surfaces would improve perceived quality.
- **Change:** redesigned the live verdict as a more deliberate badge, upgraded insight cards with accent rails/background depth, and rebuilt the exported HTML report with a stronger chalkboard layout, header, and section cards.
- **Files:** `public/alpha.html`, `synthesis/templates.js`
- **Validation:** `public/alpha.html` inline JS parsed via `vm.Script`; `synthesis/templates.js` imported successfully.
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. UI and exported report now feel visually consistent and more professional.

## Experiment 17 — Tokenomics base score normalization + circulating supply cap
- **Hypothesis:** `scoreTokenomicsRisk` started at base 6 while all other dimensions used base 4-5, creating an upward bias. Also, `pct_circulating` wasn't capped at 100, allowing CoinGecko rounding artifacts (>100%) to add phantom bonus points.
- **Change:** aligned base to 5 (consistent with other dimensions), capped `pct_circulating` at 100, adjusted the bonus curve to `pct/40` (max +2.5 at 100%), added a small +0.3 bonus for available `roi_data`.
- **Files:** `synthesis/scoring.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. More accurate tokenomics scores; no free points from data artifacts.

## Experiment 18 — GitHub collector: language, description, license, watchers fields
- **Hypothesis:** GitHub API already returns `language`, `description`, `license`, and `watchers_count` in the repo response, but the collector was discarding them. These fields are useful for LLM context and future scoring dimensions.
- **Change:** added `language`, `description`, `license`, `watchers` to `createEmptyGithubResult` and populated them from `repoData` in the return statement.
- **Files:** `collectors/github.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Richer GitHub data at zero API cost; backward compatible (new optional fields).

## Experiment 19 — Error-resilient scoring: safeCollector guard
- **Hypothesis:** collectors that return `{ error: "...", totalVolume: ... }` would still have their numeric fields scored. If the collector has an error key, those numbers are unreliable — scoring should treat them as missing.
- **Change:** added `safeCollector()` helper that returns `{}` for any collector with `error` set. Applied to all 5 scoring functions in `calculateScores`.
- **Files:** `synthesis/scoring.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass; manual test confirmed error-keyed collectors score as 0-data.
- **Result:** kept. Prevents phantom scores from partially-failed collectors.

## Experiment 20 — Tokenomics timeout: per-collector fresh clock
- **Hypothesis:** tokenomics must await market before starting Messari calls. Wrapped inside the global `withTimeout`, the tokenomics collector could have < 12s left if market took 8+s. This causes unnecessary timeouts.
- **Change:** removed tokenomics from the main `Promise.allSettled` timeout; instead applied a fresh 12s `withTimeout` that starts only after market resolves via `.then()` chaining.
- **Files:** `collectors/index.js`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Tokenomics gets a full 12s window regardless of market latency.

## Experiment 21 — UX: GitHub card in market board + change colorization
- **Hypothesis:** the new `language`, `description`, `license`, and `watchers` fields collected in Exp 18 weren't visible anywhere in the UI. Also, TVL change % values would benefit from green/red coloring to instantly signal direction.
- **Change:** added `renderGithubCard()` function and CSS (`github-card`, `lang-badge`, `license-badge`, `stat-badge`); injected card below metric table. Added `pos-change`/`neg-change` CSS classes and `changeClass()` helper for TVL % rows.
- **Files:** `public/alpha.html`
- **Test:** `node --test test/*.test.js` → 15/15 pass
- **Result:** kept. Market board now surfaces repo context inline; direction coloring improves data scanability.
