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

## AutoResearch Batch — 30 Rounds (2026-03-25 02:00 UTC)

### Round 1 — Social Collector: Keyword Expansion + Domain Trust Scoring
- **Change:** Expanded bullish/bearish keyword lists (+13 each); added `TRUSTED_DOMAINS` set (12 reputable crypto publications); weighted sentiment counts by domain trust score (1.4x for tier-1 sources vs 1.0x baseline); added new `unlock_mentions`/`exploit_mentions` query.
- **Files:** `collectors/social.js`
- **Tests:** 15/15 pass

### Round 2 — DexScreener Collector: Buy/Sell Pressure Signal
- **Change:** Added `buys_24h`, `sells_24h`, `buy_sell_ratio`, and `pressure_signal` ('buy_pressure'|'sell_pressure'|'balanced') by aggregating 24h txn counts across all DEX pairs.
- **Files:** `collectors/dexscreener.js`
- **Tests:** 15/15 pass

### Round 3 — Alpha Signals: DEX Pressure + Revenue-Generating Signals
- **Change:** Added two new alpha signal detectors: `dex_buy_pressure` (buy/sell ratio >= 1.15) and `revenue_generating` (fees_7d > $100K + efficiency > $50/M TVL/wk).
- **Files:** `services/alpha-signals.js`
- **Tests:** 15/15 pass

### Round 4 — Red Flags: DEX Sell Pressure + Low Liquidity + Concentration
- **Change:** Added three new red flags: `dex_sell_pressure` (ratio <= 0.87), `very_low_dex_liquidity` (< $50K), and `single_pool_liquidity_concentration` (> 90% in one pool).
- **Files:** `services/red-flags.js`
- **Tests:** 15/15 pass

### Round 5 — Scoring: Risk Dimension Incorporates DEX Buy/Sell Pressure
- **Change:** Added ±0.5/0.8 adjustment to risk score based on DEX pressure signal; reasonings now includes pressure ratio.
- **Files:** `synthesis/scoring.js`
- **Tests:** 15/15 pass

### Round 6 — Onchain Collector: TVL Stickiness Signal
- **Change:** Added `tvl_stickiness` field ('sticky'|'moderate'|'fleeing') based on 7d/30d TVL change thresholds. Sticky = capital retention, Fleeing = capital exit.
- **Files:** `collectors/onchain.js`
- **Tests:** 15/15 pass

### Round 7 — Scoring: Onchain Health Incorporates TVL Stickiness
- **Change:** Added ±0.4/0.5 adjustment to onchain_health score based on TVL stickiness signal.
- **Files:** `synthesis/scoring.js`
- **Tests:** 15/15 pass

### Round 8 — Templates: Surface DEX Pressure + TVL Stickiness in Reports
- **Change:** `extractKeyMetrics` now includes `dex_pressure`, `dex_buy_sell_ratio`, `tvl_stickiness`; text report surfaces these metrics in Key Metrics section.
- **Files:** `synthesis/templates.js`
- **Tests:** 15/15 pass

### Round 9 — Market Collector: ATL Distance % + Price Range Position
- **Change:** Added `atl_distance_pct` (+% above ATL) and `price_range_position` (0=ATL, 1=ATH) derived from ATL/ATH market data. Previously ATL was returned but distance wasn't computed.
- **Files:** `collectors/market.js`
- **Tests:** 15/15 pass

### Round 10 — Scoring: Market Strength Uses Price Range Position
- **Change:** Added ±0.3/0.6 adjustment based on `price_range_position` — near ATH confirms momentum, near ATL signals capitulation risk.
- **Files:** `synthesis/scoring.js`
- **Tests:** 15/15 pass

### Round 11 — GitHub Repos: Added 40+ Well-Known DeFi/L2 Protocol Mappings
- **Change:** Expanded `github-repos.json` with Curve, Compound, Maker, Yearn, Synthetix, Optimism, Arbitrum, Celestia, Pendle, EigenLayer, Morpho, Kamino, Drift, PancakeSwap, SushiSwap, Balancer, GMX, dYdX, Jupiter, Raydium, Jito, Pyth, Wormhole, LayerZero, Scroll, zkSync, Polygon, and 15+ more.
- **Files:** `collectors/github-repos.json`
- **Tests:** 15/15 pass

### Round 12 — Thesis Generator: Price Range + TVL Stickiness Context in Bull/Bear Cases
- **Change:** Added `priceRangeNote` (near ATH/ATL/range context) and `stickinessNote` to all three thesis cases (bull/bear/neutral) for richer investment narrative.
- **Files:** `services/thesis-generator.js`
- **Tests:** 15/15 pass

### Round 13 — LLM Prompt: Buy/Sell Pressure + Price Range Position Context
- **Change:** Added DEX buy/sell pressure block to full-scan prompt; added `## PRICE RANGE CONTEXT` section with ATH/ATL distances and TVL stickiness for Grok to reference in analysis.
- **Files:** `synthesis/llm.js`
- **Tests:** 15/15 pass

### Round 14 — Change Detector: Score Momentum Direction + Verdict Upgrade/Downgrade
- **Change:** Added `score_momentum` ('improving'|'deteriorating'|'neutral') from comparing up/down score dimension changes; added `verdict_direction` ('upgrade'|'downgrade'|null) using VERDICT_RANK mapping.
- **Files:** `services/change-detector.js`
- **Tests:** 15/15 pass

### Round 15 — Alpha Router: New `/alpha/trending` Endpoint
- **Change:** Added `GET /alpha/trending?window_hours=24&limit=10` returning recently-scanned projects with verdict, score, signal count, and DEX/TVL signals. Useful for monitoring scan activity.
- **Files:** `routes/alpha.js`
- **Tests:** 15/15 pass

### Round 16 — Collector Cache: Per-Collector TTLs for DEX/Reddit/Holders/Contract
- **Change:** Added tuned TTLs for all 10 collectors (DEX: 3min, Reddit: 20min, Holders: 1h, Contract: 1h, Ecosystem: 15min). Added `CACHE_TTL_<COLLECTOR>=<seconds>` env var override system.
- **Files:** `services/collector-cache.js`
- **Tests:** 15/15 pass

### Round 17 — Tokenomics Collector: Vesting Info Extraction from Messari
- **Change:** Added `pluckVestingInfo()` extracting `launch_date`, `vesting_schedule_summary`, and `team_allocation_pct` from Messari profile data. Surfaced as `vesting_info` in tokenomics output.
- **Files:** `collectors/tokenomics.js`
- **Tests:** 15/15 pass

### Round 18 — Red Flags: High Team Allocation Warning
- **Change:** Added `high_team_allocation` flag (warning >25%, critical >40% team/insider allocation) using Messari vesting data when available.
- **Files:** `services/red-flags.js`
- **Tests:** 15/15 pass

### Round 19 — Fetch.js: Jitter on Retry Backoff
- **Change:** Added `jitterMs()` function adding ±25% random jitter to retry backoff delays — reduces thundering herd on shared APIs (CoinGecko, DeFiLlama) when multiple scans fail simultaneously.
- **Files:** `collectors/fetch.js`
- **Tests:** 15/15 pass

### Round 20 — Report Quality: Data Freshness Score Component
- **Change:** Added `computeDataFreshness()` scoring collector freshness (100 for fresh, 70 for cache, 40 for stale-cache, 0 for error). Surfaced as `data_freshness_score` in quality output; deducts up to 10 points from quality_score when < 50.
- **Files:** `services/report-quality.js`
- **Tests:** 15/15 pass

### Round 21 — Sector Benchmarks: Volume Efficiency Metric
- **Change:** Added `volume_efficiency` comparison (project volume/TVL vs sector median) to `compareToSector()` output, with context ('high-velocity'|'low-velocity'|'average-velocity').
- **Files:** `services/sector-benchmarks.js`
- **Tests:** 15/15 pass

### Round 22 — Alpha Router: New `/alpha/stats` Endpoint
- **Change:** Added `GET /alpha/stats` returning total_scans, unique_projects, scans_last_24h, verdict_distribution, and avg_overall_score_7d — useful for monitoring and analytics dashboards.
- **Files:** `routes/alpha.js`
- **Tests:** 15/15 pass

### Round 23 — Social Collector: Unlock/Exploit-Specific Query + Mention Tracking
- **Change:** Added 5th Exa query specifically targeting unlock/vesting/exploit/security mentions; added `unlock_mentions` and `exploit_mentions` counters in return payload.
- **Files:** `collectors/social.js`
- **Tests:** 15/15 pass

### Round 24 — Red Flags: Social-Sourced Exploit + Token Unlock Warnings
- **Change:** Added `exploit_mentions_social` (≥2 mentions = warning, ≥4 = critical) and `token_unlock_news` (≥2 mentions of unlock/vesting = warning) flags from social collector data.
- **Files:** `services/red-flags.js`
- **Tests:** 15/15 pass

### Round 25 — LLM Prompt: Volume Efficiency + P/TVL vs Sector in Full-Scan
- **Change:** Added `## VOLUME & VALUATION EFFICIENCY VS SECTOR` section to buildPrompt() surfacing volume_efficiency and price_to_tvl from sector_comparison for Grok to reference in analysis.
- **Files:** `synthesis/llm.js`
- **Tests:** 15/15 pass

### Round 26 — Quick LLM: Retry Chain with Fallback
- **Change:** Replaced single-attempt + manual retry with a structured attempts array (same model, increasing timeouts: 25s → 35s) with per-attempt error handling; breaks on SyntaxError (corrupt content, not transient); logs all failures.
- **Files:** `synthesis/llm.js`
- **Tests:** 15/15 pass

### Round 27 — Alpha Router: New `/alpha/batch` Endpoint
- **Change:** Added `POST /alpha/batch` accepting JSON `{ projects: ["btc","eth",...] }` (max 5), running quick scans in parallel and returning compact verdict/score/pitch/cache per project. Reuses existing cache + single-flight infrastructure.
- **Files:** `routes/alpha.js`
- **Tests:** 15/15 pass

### Round 28 — Templates: Investment Thesis Section in Text/JSON Report
- **Change:** Added bull/bear/neutral thesis to text report (📈 Investment Thesis section); thesis is now included in the `json` output object when available; HTML report already included it via `rawData`.
- **Files:** `synthesis/templates.js`
- **Tests:** 15/15 pass

### Round 29 — Competitor Detection: Fuzzy Project Matching + MCap in Peers
- **Change:** Improved project self-detection using name+slug+symbol fuzzy matching (not just name); exclude by both name and slug; added `mcap` field to peer entries; included P/TVL and MCap in `comparison_summary`.
- **Files:** `services/competitor-detection.js`
- **Tests:** 15/15 pass

### Round 30 — REST: Updated `/api/health` Endpoint Directory
- **Change:** Updated endpoint directory in `/api/health` to include all new endpoints: `/alpha/batch`, `/alpha/history`, `/alpha/compare`, `/alpha/leaderboard`, `/alpha/trending`, `/alpha/stats`, `/alpha/export`.
- **Files:** `routes/rest.js`
- **Tests:** 15/15 pass
