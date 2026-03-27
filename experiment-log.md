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

### Round 31 — X/Twitter Sentiment Supplement in calculateScores
- **Change:** Added X/Twitter (Grok Fast) sentiment adjustment to `scoreSocialMomentum` via `calculateScores`. KOL-weighted: volume-adjusted sentiment score contributes max ±0.5 + ±0.15 KOL bonus to social score.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 32 — Alpha Signals: X/Twitter KOL Bullish/Bearish Signals
- **Change:** Added `kol_bullish_x_sentiment` and `kol_bearish_x_sentiment` signals to `detectAlphaSignals` using x_social data (notable accounts + sentiment).
- **Files:** `services/alpha-signals.js`
- **Tests:** 164/164 pass

### Round 33 — Category Weights: RWA and DePIN Categories
- **Change:** Added `rwa` and `depin` category weight sets to `CATEGORY_WEIGHTS`; added 9 new CATEGORY_MAP entries for real-world assets and decentralized physical infrastructure.
- **Files:** `scoring/category-weights.js`
- **Tests:** 164/164 pass

### Round 34 — Circuit Breakers: Stablecoin De-peg + Thin Liquidity Dump
- **Change:** Added stablecoin de-peg circuit breaker (10%+ off peg = cap 3.0, 3%+ = cap 5.0); added cascading failure breaker for active dump + <$500K liquidity.
- **Files:** `scoring/circuit-breakers.js`
- **Tests:** 164/164 pass

### Round 35 — Templates: X/Twitter KOL Names in Text Report
- **Change:** Surface x_social notable_accounts (as @handles) and key_narratives in the text report's X sentiment section when available.
- **Files:** `synthesis/templates.js`
- **Tests:** 164/164 pass

### Round 36 — Development Score: dev_quality_index (0-100)
- **Change:** Added `dev_quality_index` normalized 0-100 composite to development score output. Combines contributor breadth, commit velocity, traction (stars), freshness, CI/CD, repo health, ecosystem breadth, license.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 37 — Onchain Health: onchain_maturity_score (0-100)
- **Change:** Added `onchain_maturity_score` normalized 0-100 composite measuring protocol sustainability (fees, TVL stability, stickiness, chain diversification, active users, value capture).
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 38 — Volatility Guard: risk_tier Label
- **Change:** Added `risk_tier` field to `assessVolatility` return — combines 24h regime + weekly class into a human-readable label (low_risk/moderate_risk/elevated_risk/high_risk/critical_risk).
- **Files:** `services/volatility-guard.js`
- **Tests:** 164/164 pass

### Round 39 — Market Strength: market_efficiency_score (0-100)
- **Change:** Added `market_efficiency_score` normalized 0-100 metric to `scoreMarketStrength` output. Measures volume/mcap liquidity, trend confirmation, listing quality, market rank, community signal, FDV transparency.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 40 — MCP: New `x_sentiment` Tool
- **Change:** Added `x_sentiment` MCP server tool that queries x_social collector and returns structured X/Twitter sentiment for a project (sentiment, volume, KOL, narratives, notable accounts).
- **Files:** `routes/mcp.js`
- **Tests:** 164/164 pass

### Round 41 — Tokenomics Score: tokenomics_risk_score (0-100)
- **Change:** Added `tokenomics_risk_score` normalized 0-100 (higher=safer) composite to tokenomics output. Combines circulating pct, inflation, distribution data, dilution risk, unlock safety.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 42 — Fetch.js: Improved Error Messages
- **Change:** HTTP error messages now include `statusText` and a truncated URL hint (max 120 chars → ellipsis) for cleaner debug logs.
- **Files:** `collectors/fetch.js`
- **Tests:** 164/164 pass

### Round 43 — Thesis Generator: conviction_score (0-100)
- **Change:** Added `conviction_score` field to thesis output combining overall score (50%), evidence richness (25%), and data coverage (25%).
- **Files:** `services/thesis-generator.js`
- **Tests:** 164/164 pass

### Round 44 — Templates: Structured data_quality_summary in JSON Output
- **Change:** Added `data_quality` structured object to JSON report with total/ok/failed collectors, coverage_pct, completeness_pct, overall_confidence, data_freshness_score, quality_tier.
- **Files:** `synthesis/templates.js`
- **Tests:** 164/164 pass

### Round 45 — Alpha Signals: Social Divergence (X vs Web)
- **Change:** Added `x_vs_web_bullish_divergence` and `x_vs_web_bearish_divergence` signals when X/Twitter sentiment diverges >0.5 from Exa/web sentiment score.
- **Files:** `services/alpha-signals.js`
- **Tests:** 164/164 pass

### Round 46 — Templates: category_detection Metadata in JSON Output
- **Change:** Added `category_detection` object to JSON report exposing detected category, source, confidence, and confidence_label — helps consumers understand how reliable the category-adaptive weights are.
- **Files:** `synthesis/templates.js`
- **Tests:** 164/164 pass

### Round 47 — Change Detector: velocity_acceleration
- **Change:** Added `velocity_acceleration` and `acceleration_label` to change detection output — compares the most recent score delta to the prior delta to detect if improvement/decline is accelerating or decelerating.
- **Files:** `services/change-detector.js`
- **Tests:** 164/164 pass

### Round 48 — Social Score: social_health_index (0-100)
- **Change:** Added `social_health_index` normalized 0-100 composite to social momentum output. Combines mention volume, sentiment quality, narrative depth, signal quality (bot ratio), and institutional mentions.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 49 — Alpha Signals: Short Interest Proxy
- **Change:** Added `short_interest_proxy` signal detecting high FDV/MCap (>5x) combined with active DEX sell pressure (<0.6 buy/sell ratio) — proxy for potential insider/VC distribution.
- **Files:** `services/alpha-signals.js`
- **Tests:** 164/164 pass (reverted naming conflict in first attempt)

### Round 50 — Market Score: Stablecoin Guard
- **Change:** Added `isStablecoin()` detection function; stablecoins get a flat 5.0 market strength score instead of invalid momentum signals. Added `STABLECOIN_SYMBOLS` constant covering 20+ stable assets.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 51 — Narrative Momentum: narrative_dominance_score (0-100)
- **Change:** Added `narrative_dominance_score` to `detectNarrativeMomentum` output — measures narrative concentration/coherence (higher = stronger story). Bullish alignment adds +15 bonus.
- **Files:** `services/narrative-momentum.js`
- **Tests:** 164/164 pass

### Round 52 — Templates: composite_alpha_index (0-100) in JSON Output
- **Change:** Added `composite_alpha_index` to JSON report — single normalized 0-100 opportunity score combining overall score (50%), alpha signal count (15%), data quality tier (20%), and thesis conviction (15%).
- **Files:** `synthesis/templates.js`
- **Tests:** 164/164 pass

### Round 53 — Alpha Signals: getSignalStrengthScore() Export
- **Change:** Added `getSignalStrengthScore(signals)` export to alpha-signals.js — computes 0-100 weighted aggregate signal strength (strong=20pts, moderate=12pts, weak=6pts per signal).
- **Files:** `services/alpha-signals.js`
- **Tests:** 164/164 pass

### Round 54 — Templates: red_flags_summary in JSON Output
- **Change:** Added compact `red_flags_summary` object to JSON report with total/critical/warnings/info counts, worst_flag, and risk_level tier — for fast MCP consumer risk assessment.
- **Files:** `synthesis/templates.js`
- **Tests:** 164/164 pass

### Round 55 — Onchain Score: protocol_age_tier Field
- **Change:** Added `protocol_age_tier` field to onchain health output (mature/established/growing/early/unknown) derived from TVL, fees, and existing protocol_maturity field.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 56 — LLM Data Summary: X vs Web Sentiment Divergence
- **Change:** Added X/Twitter vs web/Exa sentiment divergence delta to `buildDataSummary` LLM context. Also improved KOL account formatting (added @ prefix). Gives LLM explicit divergence signal.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 57 — Momentum: momentum_alignment_score (0-100)
- **Change:** Added `momentum_alignment_score` and `momentum_alignment_label` to `calculateMomentum` output — measures how many dimensions are aligned improving/declining.
- **Files:** `services/momentum.js`
- **Tests:** 164/164 pass

### Round 58 — Risk Score: liquidity_risk_score (0-100)
- **Change:** Added `liquidity_risk_score` normalized 0-100 (higher=safer) composite to risk score output. Combines DEX liquidity depth, holder concentration, volatility, and liquidity category.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 59 — Elevator Pitch: one_line_risk Field
- **Change:** Added `one_line_risk` field to elevator pitch output — extracts the worst red flag detail (truncated to 120 chars) as a one-liner risk for quick consumption.
- **Files:** `services/elevator-pitch.js`
- **Tests:** 164/164 pass

### Round 60 — Watchlist: watchlist_score + one_line_risk
- **Change:** Added `watchlist_score` (0-100) to watchlist endpoint output — balances overall score (60%), alpha signals (20%), red flag penalties (20%), volatility penalty. Updated sort to use watchlist_score. Also surfaces `one_line_risk` in watchlist items.
- **Files:** `routes/alpha.js`
- **Tests:** 164/164 pass

## AutoResearch UX & Layout Batch — 30 Rounds (2026-03-26 00:30 UTC)

### Round 61 — Mobile hamburger menu (alphascan.html)
- **Change:** Added hamburger button + sliding mobile nav panel to scanner page header. Keyboard accessible, aria-expanded, closes on outside click. Logic in `hamburger.js`.
- **Files:** `public/alphascan.html`, `public/js/hamburger.js`
- **Tests:** 164/164 pass

### Round 62 — Input field polish: hover state, stronger focus ring, better placeholder contrast
- **Change:** Improved #project-input with hover state, 4px focus box-shadow, dimmer placeholder (#5e5e5e vs #7e7e7e) for better visual feedback. Slightly larger padding (15px vs 14px).
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 63 — Score rows: 2-col stack on mobile (label + value / bar below)
- **Change:** At ≤720px, score rows switch to 2-col (label + score), bar spans full width below — much more readable than the 3-col grid that compressed too hard.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 64 — Skeleton screens: staggered reveal + pulse glow + smoother shimmer
- **Change:** Skeleton panels now stagger in (0/8/16ms), have a subtle orange-border pulse animation, and use a wider (800px) shimmer gradient for smoother loading feel.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 65 — Loading bar: multi-color sweep glow animation
- **Change:** Replaced flat progress bar with a 60%-width glow sweep (warm palette), added a ::after pulse, smoother cubic-bezier timing.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 66 — Scanner hero: tighter vertical padding (72px vs 96px)
- **Change:** Scanner page hero feels less wasteful — more screen estate for the scan form above fold on medium-sized screens.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 67 — How-it-works cards: consistent height, border, hover elevation, connector tweaks
- **Change:** Each how-step is now a proper card (border + bg + radius + hover lift). Connector line repositioned to center of step numbers accurately.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 68 — Landing page (index.html) mobile hamburger menu
- **Change:** Same hamburger pattern applied to index.html header. Tablet layout updated (2-col products/diff grid at 641-1060px). Trust logos smaller on mobile.
- **Files:** `public/index.html`
- **Tests:** 164/164 pass

### Round 69 — Verdict badge redesign: flex column layout, glow shadow, mono overall score
- **Change:** Verdict badge now uses box-shadow glow matching its class (buy/hold/avoid), overall score uses IBM Plex Mono, verdict-wrap is flex column vs grid.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 70 — Section labels: left accent bar + spacing improvements
- **Change:** All .section-label elements get a 14px orange accent bar via ::before pseudo. Result panel spacing is now consistent 20px gaps.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 71 — Score bars: color-coded value + tone pill color
- **Change:** Score value now uses the bar's own color (green→orange→red). Tone label (High conviction / Constructive / Mixed / Fragile) uses matching color. Bar glow via box-shadow.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 72 — Project intro card: ticker badge + website link
- **Change:** Intro card now shows symbol ticker (monospace badge) and optional website link inline with the title row.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 73 — Analysis text: Inter font, drop-cap first letter, improved line-height
- **Change:** Analysis text switched from IBM Plex Mono to Inter (much more readable for body text). First letter gets an orange drop-cap. Line-height 1.85.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 74 — Radar chart: score ticks, radial gradient fill, better aria-label
- **Change:** Grid ticks show scores at even levels (2/4/6/8/10). Radar fill uses radialGradient (center bright, edge dim). aria-label lists all dimension scores for accessibility.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 75 — Scan buttons: full-width on ≤560px
- **Change:** At small screen widths, both scan buttons stack full-width (flex-column) for easier thumb tapping.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 76 — Payment modal: step indicator + feature badges + cleaner pricing block
- **Change:** Modal now shows ① Connect → ② Confirm tx → ③ Analysis step indicator that advances during payment. Feature badges show what's included. Pricing in a bordered card.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 77 — Landing page: tablet product grid + trust logo mobile improvements
- **Change:** Products grid → 2-col at 641-1060px. Diff grid → 2-col at same breakpoint. Trust logos get smaller font/padding on mobile.
- **Files:** `public/index.html`
- **Tests:** 164/164 pass

### Round 78 — Landing page: mobile hero / CTA improvements
- **Change:** Buttons stretch full-width, centered max-width container. Hero sub smaller on mobile. Product/diff cards more compact. Hero badge font-size scales down.
- **Files:** `public/index.html`
- **Tests:** 164/164 pass

### Round 79 — Scroll-to-top button
- **Change:** Fixed orange-themed scroll-to-top button appears after 400px scroll, hover lift animation, CSP-compliant (moved to utils.js).
- **Files:** `public/alphascan.html`, `public/js/utils.js`
- **Tests:** 164/164 pass

### Round 80 — Bull/Bear panels: card treatment instead of border-left
- **Change:** Bull and bear columns now have card backgrounds (green/red tint), border, border-radius, and hover states — much cleaner visual separation.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 81 — Trade setup panel: color-coded tiles with border/bg per type
- **Change:** Entry/SL/TP/RR tiles now have matching border and background colors (cyan=entry, red=SL, green=TP, yellow=position size). "Not financial advice" disclaimer added.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 82 — Report quality footer: data confidence bar + source badges
- **Change:** Replaced flat text quality section with animated quality score bar, verdict confidence pill, data sources as styled badges, and a "New scan" button in footer.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 83 — Social proof section: tablet 2-col testimonials + mobile stat fixes
- **Change:** Testimonials grid → 2-col at tablet breakpoint. Social stat borders fixed for 4th cell. stat-val smaller on mobile.
- **Files:** `public/index.html`
- **Tests:** 164/164 pass

### Round 84 — API code block: header with language label + copy button
- **Change:** Code block gets a styled header row with "HTTP / MCP" label and a copy-to-clipboard button that shows "Copied!" feedback.
- **Files:** `public/index.html`
- **Tests:** 164/164 pass

### Round 85 — Loading state: progressive contextual step messages
- **Change:** Instead of a static "Full deep scan..." message, the footer label cycles through contextual steps (Fetching market data → Querying DeFiLlama → GitHub → X/Twitter → AI analysis → Building report) with fade transitions.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 86 — Metrics dashboard: mono stat values + card hover + tablet responsive
- **Change:** Stat values use IBM Plex Mono. Cards get hover border highlight. Tablet breakpoint for grid-3 → 2-col at 641-900px. Progress bars slightly thinner (6px).
- **Files:** `public/metrics.html`
- **Tests:** 164/164 pass

### Round 87 — Signals page: mobile card view for signal table
- **Change:** At ≤680px, the signals table is hidden and a card-based view appears instead. Each signal card shows symbol/direction/strategy header + entry/SL/TP/RR rows. Stats grid 2-col on ≤500px.
- **Files:** `public/signals.html`
- **Tests:** 164/164 pass

### Round 88 — DexScreener autocomplete: keyboard hint footer + mobile sizing
- **Change:** Dropdown gets a keyboard hint bar (↑↓ Navigate / ↵ Select / Esc Close) below results. Hidden on mobile (touch devices don't use keyboard). Max-height 260px on small screens.
- **Files:** `public/alphascan.html`, `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 89 — Accessibility: sr-only utility, aria-describedby on input, focus management
- **Change:** Added .sr-only utility class. Input gets aria-describedby pointing to a hidden description. After results load, project name receives tabindex=-1 focus for screen reader announcement.
- **Files:** `public/alphascan.html`, `public/index.html`, `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 90 — Landing page: mobile overflow fixes + footer improvements
- **Change:** trynow-steps arrows hidden on ≤400px to prevent overflow, font-size reduced. Footer links stack on very small screens. About chip letter-spacing. Section padding reduced on ultra-small.
- **Files:** `public/index.html`
- **Tests:** 164/164 pass

### Round 91 — Toast notification system
- **Change:** Added global `window.showToast(message, type, durationMs)` in utils.js. Toast container fixed bottom-right, stacked column. Share button in report footer copies URL + shows toast feedback. Type=success/error/info with matching colors.
- **Files:** `public/alphascan.html`, `public/js/utils.js`, `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 92 — How-it-works steps: step counter badges + hover lift
- **Change:** CSS counters on `.how-grid` reset + `.how-step::after` shows step number (1/2/3) in branded badge top-right. Hover lift increased to -4px with box-shadow glow.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 93 — Scroll-aware header shrink
- **Change:** `header.scrolled` class added via rAF-throttled scroll listener in hamburger.js (shared). Header-inner height transitions from 64px to 56px; background darkens slightly.
- **Files:** `public/alphascan.html`, `public/index.html`, `public/js/hamburger.js`
- **Tests:** 164/164 pass

### Round 94 — Score bars: min-height touch comfort + mobile layout
- **Change:** score-row min-height 48px for touch comfort. Mobile score-row font-weight 700 on value. Label text-overflow ellipsis for long labels.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 95 — Hero headline: animated gradient text
- **Change:** `h1.hero-headline em` gets CSS animated linear-gradient shifting 90deg over 4s. Respects prefers-reduced-motion (fallback to flat color).
- **Files:** `public/index.html`
- **Tests:** 164/164 pass

### Round 96 — Skeleton screens v2: 3-panel layout
- **Change:** showSkeleton() now renders 3 skeleton panels matching real report: header+analysis, radar+market board, bull/bear. Bull/bear has green/red tinted borders.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 97 — metrics.html: Inter font + IBM Plex Mono for stat values
- **Change:** Added Inter + IBM Plex Mono Google Font imports. body font-family updated to Inter. stat-value uses IBM Plex Mono.
- **Files:** `public/metrics.html`
- **Tests:** 164/164 pass

### Round 98 — Panel visual rhythm + rescan-btn CSS class
- **Change:** Added CSS rule for panel+panel::before separator line (gradient). rescan-btn moved from inline JS styles to CSS class.
- **Files:** `public/alphascan.html`, `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 99 — signals.html: consistent design system
- **Change:** Inter + IBM Plex Mono fonts added. CSS vars updated to match main design system (--bg, --card, --border, --accent = #D4580A). Stat values use IBM Plex Mono + orange accent. CTA button solid black text.
- **Files:** `public/signals.html`
- **Tests:** 164/164 pass

### Round 100 — Commit R91-100
- **Commit:** 6499fa0 — 287 lines changed across 7 files. Pushed to main.

### Round 101 — diff-card: icon wrapper + hover glow
- **Change:** `.diff-icon-wrap` 48×48px rounded box with orange border/bg. Hover: box-shadow glow + card lift -3px + radial gradient overlay. Diff icons wrapped in `.diff-icon-wrap` in HTML.
- **Files:** `public/index.html`
- **Tests:** 164/164 pass

### Round 102 — Project intro card: market cap chip
- **Change:** Ticker badge uses orange styling. Added market cap chip (IBM Plex Mono, dim badge). Category label now shows "Category" label before the badge. Website link has border+hover transition.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 103 — Footer links: underline slide-in animation
- **Change:** `.footer-links a::after` pseudo-element: 1px underline scales from 0 to 1 on hover (transform-origin left). Applied to both alphascan.html and index.html.
- **Files:** `public/alphascan.html`, `public/index.html`
- **Tests:** 164/164 pass

### Round 104 — Error panel: structured layout + retry button
- **Change:** `.error` now flex-column with `.error-hint`, `.error-actions`. Added "Retry" button alongside "Try quick scan". Visual separation: hint in muted, actions as bordered links.
- **Files:** `public/alphascan.html`, `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 105 — Try-it-now steps: pill badge style
- **Change:** `.trynow-steps span` gets border+background pill styling (not just plain text). Arrow spans keep no border. More visual structure.
- **Files:** `public/index.html`
- **Tests:** 164/164 pass

### Round 106 — Volatility badge: softer colors, border style
- **Change:** Volatility badge now uses semi-transparent bg + border (matching design system). elevated=yellow, high=orange, extreme=red. No more solid colored bg that breaks on dark bg.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 107 — Trade tiles: .trade-tiles class + mobile 2-col
- **Change:** Trade setup tiles use `.trade-tiles` CSS class with flex-wrap. `flex: 1 1 120px`. On ≤560px: 2-column grid. Chart SVG gets `min-width: 320px; overflow-x: auto`.
- **Files:** `public/alphascan.html`, `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 108 — Product tag badge redesign
- **Change:** `.product-tag` now shows a pulsing dot `::before` pseudo-element. Added `font-weight:600` and `letter-spacing`. `.dim` variant hides the dot.
- **Files:** `public/index.html`
- **Tests:** 164/164 pass

### Round 109 — Input clear button
- **Change:** Added `#input-clear-btn` (×) absolutely positioned inside `.input-wrap`. JS shows/hides via `.visible` class based on input length. Clears value + focuses input. Works for both DexScreener and CoinGecko item selection.
- **Files:** `public/alphascan.html`, `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 110 — Commit R101-110
- **Commit:** be39986 — 169 lines changed. Pushed to main.

### Round 111 — Mobile hero CTAs: aligned stretch layout
- **Change:** alphascan.html ≤560px: hero-ctas flex-column stretch with max-width 320px centered. Both buttons 100% width, justify center.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 112 — Score bars: tone pill with icon
- **Change:** Tone labels now use icon prefix (↑→~↓) + colored pill with bg/border per level. toneData array drives the mapping. More readable at a glance.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 113 — About chips: hover transition
- **Change:** `.about-chip` gets hover state: orange border + slightly lighter bg. More interactive, consistent with rest of design.
- **Files:** `public/index.html`
- **Tests:** 164/164 pass

### Round 114 — Panel stagger: CSS custom props
- **Change:** `#report .panel` uses `--stagger-delay` CSS var for animation-delay. Cleaner than :nth-child inline delays. Also staggered rescan-btn.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 115 — Analysis text: key sentence emphasis
- **Change:** formatAnalysisText() now escapes HTML then adds `<strong>` with color on BUY/HOLD/AVOID/bullish/bearish/etc matches. Positive=orange, negative=red/pink, neutral=warm. Improves scannability.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 116 — Focus visible: thicker ring + glow
- **Change:** :focus-visible outline 2.5px + box-shadow 4px rgba(212,88,10,0.12). Buttons get outline-offset:2px. Applied to both alphascan.html and index.html.
- **Files:** `public/alphascan.html`, `public/index.html`
- **Tests:** 164/164 pass

### Round 117 — metrics.html: card hover glow
- **Change:** `.card` gets transform -1px + box-shadow + orange border-color on hover. Removed duplicate Round 86 hover rule.
- **Files:** `public/metrics.html`
- **Tests:** 164/164 pass

### Round 118 — Stat values: text-shadow glow + stat-box hover
- **Change:** `.stat-val` gets orange text-shadow glow. stat-box hover adds orange tint bg.
- **Files:** `public/alphascan.html`
- **Tests:** 164/164 pass

### Round 119 — Score bars: reasoning tooltip
- **Change:** Each score-row gets `title` attribute from `dim.reasoning` (truncated 140 chars). Provides hover context for power users without cluttering the UI.
- **Files:** `public/js/alphascan.js`
- **Tests:** 164/164 pass

### Round 120 — Commit R111-120
- **Commit:** b803b89 — 88 lines changed. Pushed to main.

### Round 121 — CATEGORY_MAP: fix depin duplicate key (was overridden to ai_infrastructure)
- **Change:** Removed erroneous `depin: 'ai_infrastructure'` entry above the correct `depin: 'depin'` mapping. The JS object duplicate key bug meant `depin` was incorrectly classified as AI infrastructure.
- **Files:** `scoring/category-weights.js`
- **Tests:** 164/164 pass

### Round 122 — CATEGORY_MAP: add missing slugs (stablecoin, oracle, infrastructure, privacy, fan-token)
- **Change:** Added 12 new category slug mappings: stablecoin→default, oracle→ai_infrastructure, infrastructure→layer_1, cross-chain→layer_2, privacy→layer_1, insurance→defi_lending, prediction-market→defi_dex, fan-token→meme_token, sports→meme_token.
- **Files:** `scoring/category-weights.js`
- **Tests:** 164/164 pass

### Round 123 — calculateConfidence: add holder + dex confidence, graduated tokenomics scoring
- **Change:** Added holder and dex confidence dimensions (10%, 5% weight in overall). Tokenomics confidence is now graduated (base 20 + 30/25/25 per field). overall_confidence uses weighted average of 7 dimensions instead of simple average of 5.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 124 — scoreMarketStrength: empty data guard → neutral 5.0
- **Change:** When no price, volume, or market cap data exists, return 5.0 neutral instead of computing from zero values (which produced erratic low scores).
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 125 — scoreOnchainHealth: cap TVL changes to ±200%
- **Change:** TVL changes capped to [-200%, +200%] before scoring to prevent extreme new protocol launches (e.g. +10000%) or exploits (-99%) from dominating the score.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 126 — scoreDevelopment: missing github → 3.0 (unknown) not 4.0
- **Change:** When no GitHub data exists, return 3.0 instead of computing from base 4.0. Absence of dev evidence is mildly concerning, not neutral. Reasoning explicitly states "unverifiable".
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 127 — circuit-breakers: DeFi ghost protocol + extreme low token velocity
- **Change:** Two new warning breakers: (1) DeFi with TVL > $100M and zero social mentions → cap 6.5; (2) token velocity < 0.01% daily turnover → cap 6.0. Also added missing safeN helper.
- **Files:** `scoring/circuit-breakers.js`
- **Tests:** 164/164 pass

### Round 128 — red-flags: suspicious volume spike (5x MA) + team wallet spike
- **Change:** Two new red flags: (1) 24h volume > 5x 7-day average = possible wash trading/exit pump; (2) team/treasury wallet activity > $1M = insider selling risk.
- **Files:** `services/red-flags.js`
- **Tests:** 164/164 pass

### Round 129 — scoreTokenomicsRisk: no-data guard → neutral 5.0
- **Change:** When tokenomics has no usable numerical fields (pct_circulating, inflation_rate, token_distribution), return 5.0 neutral. Partial data (error + fallback values) still scores normally.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 130 — Commit R121-130
- **Commit:** 6894813 — 152 lines changed. Pushed to main.

### Round 131 — scoreDistribution: no-data guard → neutral 5.0
- **Change:** When no distribution-relevant data exists (pct_circulating, token_distribution, FDV/MCap pair), return 5.0 neutral instead of computing from partial data that defaults to 5.0 anyway with wrong reasoning.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 132 — circuit-breakers: persistent DeFi revenue collapse breaker
- **Change:** New warning breaker: if 7d revenue declined > 50% vs prior 7d AND monthly rate also declining, cap at 6.5. Renamed conflicting `fees7d` variable to `fees7dR132`.
- **Files:** `scoring/circuit-breakers.js`
- **Tests:** 164/164 pass

### Round 133 — red-flags: staking APY divergence detection
- **Change:** New red flag when advertised staking APY > 50% and realized APY diverges > 70% from advertised — signals unsustainable Ponzi-style yield mechanics.
- **Files:** `services/red-flags.js`
- **Tests:** 164/164 pass

### Round 134 — scoreRisk: empty data guard → neutral 5.0
- **Change:** When no risk-relevant fields are present (no price changes, no DEX data, no holder data, no genesis date), return 5.0 instead of optimistic 6.0. Unknown risk ≠ low risk.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 135 — scoreOnchainHealth: no-data guard → neutral 5.0
- **Change:** Many tokens are not DeFi protocols and have no TVL/fees. Instead of penalizing them with 4.0, return neutral 5.0 with "not applicable" reasoning.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 136 — category-weights: meme_token large-cap blending with L1 weights
- **Change:** High-mcap meme tokens ($1B+) blend meme weights with L1 weights proportionally (max 30% blend at $10B+). Prevents DOGE/SHIB-level assets from being evaluated purely as social tokens.
- **Files:** `scoring/category-weights.js`
- **Tests:** 164/164 pass

### Round 137 — calculateConfidence: graduated market scoring (5 fields, max 100)
- **Change:** Market confidence is now graduated: price 25pts, volume 20pts, market_cap 25pts, price_change 15pts, rank 15pts. Previously binary (30/60/100).
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 138 — calculateConfidence: graduated onchain and social scoring
- **Change:** Onchain: graduated by tvl/fees/revenue/trend (30+25+25+20). Social: graduated by mention volume/sentiment/narratives/quality (40+30+20+10).
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 139 — calculateConfidence: graduated dev (github) scoring
- **Change:** Dev confidence graduated: commits_90d 30pts, contributors 25pts, stars 20pts, last_commit 15pts, forks 10pts. Previously binary (0/50/100).
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 140 — Commit R131-140
- **Commit:** 4eae3ac — 143 lines changed. Pushed to main.

### Round 141 — circuit-breakers: DEX liquidity $10K-$50K → warning cap 5.5
- **Change:** Added intermediate breaker zone: DEX liquidity between $10K and $50K caps at 5.5 (extreme slippage risk, not quite untradeable).
- **Files:** `scoring/circuit-breakers.js`
- **Tests:** 164/164 pass

### Round 142 — scoreMarketStrength: smooth ATH distance penalty (no cliff at -80%)
- **Change:** Replaced binary cliff penalty at -80% ATH with smooth linear gradient from -50% to -95%, max -1.5 pts. Prevents harsh jumps for tokens near but not at -80%.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 143 — red-flags: unsupported price pump detection
- **Change:** New red flag: price +300% in 30d without TVL or fee backing. Critical at +1000%, warning otherwise. Catches unsustainable pump patterns.
- **Files:** `services/red-flags.js`
- **Tests:** 164/164 pass

### Round 144 — scoreMarketStrength: null-aware momentum calculation
- **Change:** Momentum now only counts non-null price_change fields. When all are null, momentum = 0 (neutral) instead of 0 from false zero values. Weights renormalize to available fields.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 145 — scoreMarketStrength: null-aware trend consistency
- **Change:** Trend consistency only counts non-null timeframes. When no price_change data, consistency = 0.5 (neutral) instead of 0.0.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 146 — category-weights: add cross_chain_bridge and derivatives categories
- **Change:** Two new weight profiles: cross_chain_bridge (risk weight 18% — bridges are top exploit vector) and derivatives (onchain 30% — volume/usage is primary signal). Updated CATEGORY_MAP with bridge/derivatives/perpetuals slugs.
- **Files:** `scoring/category-weights.js`
- **Tests:** 164/164 pass

### Round 147 — scoreRisk: volatility capping at 200% + extreme volatility tier
- **Change:** Cap change inputs at 200% to prevent absurd pump/dump values dominating. Added extreme tier: volatility > 100% = -3.0 pts (possible exploit).
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 148 — circuit-breakers: extended stablecoin symbol list
- **Change:** Added 10 more stablecoin symbols (CRVUSD, GHO, USDN, DOLA, BEAN, CUSD, USDS, USDZ, USDM, ZUSD, USDV) to de-peg detection.
- **Files:** `scoring/circuit-breakers.js`
- **Tests:** 164/164 pass

### Round 149 — scoreOnchainHealth: zero-fees penalty for DeFi with TVL
- **Change:** Protocols with TVL > $10M and zero fees penalized -1.5 pts. TVL > $1M and zero fees: -0.7 pts. Mercenary capital with no value capture = structurally weak.
- **Files:** `synthesis/scoring.js`
- **Tests:** 164/164 pass

### Round 150 — Commit R141-150
- **Commit:** pending. Pushed to main.

## AutoResearch Prompt Engineering Batch — 30 Rounds (2026-03-26 02:30 UTC)

### Round 151 — buildDataSummary: P/TVL, volume velocity, fee efficiency
- **Change:** Added derived efficiency metrics block: P/TVL ratio (MCap/TVL), volume velocity (24h vol as % of MCap), fee efficiency ($/M TVL/week). These give LLM concrete context for valuation vs fundamentals.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 152 — buildOpusPrompt: Bull/bear case concrete number anchoring
- **Change:** Updated bull_case and bear_case output instructions to MANDATE at least 2 specific numbers from RAW_DATA in the thesis. Added data-backed catalyst format examples. Added "Do NOT soften bear cases."
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 153 — buildDataSummary: GitHub velocity context labels
- **Change:** GitHub commits, contributors, stars now include human-readable context labels (e.g. "very active", "small team", "high traction"). Added language, license, watchers, dev_quality_index to GitHub block.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 154 — buildOpusPrompt: Category-specific deep analysis instructions
- **Change:** Replaced generic "adjust for category" with category-specific analysis registers for meme_token, defi_lending, defi_dex, layer_1, layer_2, rwa, depin. Each includes specific metrics to focus on and benchmarks.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 155 — validateReport: Competitor hallucination guard
- **Change:** Added validation: if competitor_comparison cites specific competitor TVL/MCap numbers but no sector_comparison data exists, replace with safe "No sector comparison data available" message. Added new hallucination pattern for invented competitor numbers.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 156 — buildDataSummary: Revenue capture ratio + TVL stickiness context
- **Change:** Added revenue capture percentage (revenue_7d/fees_7d) with label (high/moderate/low capture). Added TVL stickiness with context string. Added protocol_maturity field.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 157 — Quick report: Enriched market snapshot
- **Change:** Market snapshot now includes volume velocity (%), P/TVL ratio, market cap in B/M with rank, 30d price change, ATH distance. Uses both pct_24h and pct_percentage_24h field variants for compatibility.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 158 — buildOpusPrompt: Paragraph-level de-duplication instruction
- **Change:** Updated analysis_text instruction: each paragraph MUST cover NEW information, never repeat the same metric across paragraphs. Clear per-paragraph scope: P1=thesis, P2=on-chain (different numbers), P3=market/sentiment, P4=outlook.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 159 — validateReport: Post-processing sentence deduplication
- **Change:** Added automatic near-duplicate sentence detection and removal in analysis_text. Normalizes sentences (strips numbers/punctuation) for comparison, removes semantic duplicates. Logs warning with count.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 160 — Quick report: Anti-repetition paragraph structure
- **Change:** Updated quick report analysis_text instruction to 3 paragraphs with strict non-repetition constraint: P1=verdict+top signal, P2=2-3 supporting points, P3=risk/reward.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 161 — buildDataSummary: Social quality context
- **Change:** Social section now includes: mention count with volume label (viral/active/moderate/low), stronger sentiment gradient labels, bot ratio with quality label, sentiment breakdown (bullish%/bearish%), key narratives, unlock/exploit mention counts.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 162 — buildOpusPrompt: FINAL REMINDER anti-repetition + bull/bear number check
- **Change:** Added rules 6/7/8 to FINAL REMINDER: check for repetition across paragraphs, verify bull/bear cases have ≥2 specific numbers, check verdict-narrative consistency.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 163 — buildOpusPrompt: Verdict consistency instruction
- **Change:** Added instruction 8 to INSTRUCTIONS: verdict must be CONSISTENT with analysis_text, risks, catalysts, bull/bear cases. Inconsistent verdict/narrative = low credibility.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 164 — buildDataSummary: DEX liquidity quality labels
- **Change:** DEX section now includes: liquidity quality label (deep/good/moderate/thin/very thin), pair count with chain list, buy/sell ratio with emoji (🟢/🔴), 24h txn count (buys/sells), primary venue name.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 165 — validateReport: Bull/bear thesis quality validation
- **Change:** Added validation: if bull_case.thesis or bear_case.thesis contains no specific numbers, add a note prompting more specific language. Added probability field validation (must be high/medium/low).
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 166 — buildDataSummary: Tokenomics unlock risk context
- **Change:** Tokenomics section now includes: unlock risk label (HIGH/moderate/low), inflation rate with label, team allocation with ⚠️ if >30%, vesting schedule summary from Messari.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 167 — buildOpusPrompt: Anti-generic moat instruction
- **Change:** Moat instruction now explicitly FORBIDS generic phrases ("first mover", "network effects" without data, "strong community" without mentions). Requires concrete advantage backed by specific data or fallback to "No clear moat identified."
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 168 — buildDataSummary: Alpha signals and red flags summary
- **Change:** buildDataSummary now includes alpha signals (top 5 with strength label) and red flags (top 5 with severity) from rawData at the bottom of the summary. Gives LLM pre-processed algorithmic signals inline with data.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 169 — Output format: key_findings structured format
- **Change:** key_findings instruction now specifies format: "[Metric]: [value] — [what this means for investors]" with a concrete example. Applied to both Opus and quick report prompts.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 170 — buildScoreSummary: New export + inject into prompts
- **Change:** Added new exported `buildScoreSummary(scores)` function — builds a compact ASCII bar chart of all 7 scoring dimensions with quality labels and completeness %. Injected into both Opus user message and quick report prompt.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 171 — validateReport: analysis_text quality assessment
- **Change:** Added analysis word count and quality tier (none/minimal/brief/adequate/comprehensive) to _validation metadata. Warns if analysis_text is empty or < 50 words.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 172 — buildOpusPrompt: Risks structured format with banned generics
- **Change:** Risks instruction now specifies format: "[Risk Type]: [detail+numbers]. [Why it matters]" with examples. FORBIDDEN: "regulatory uncertainty" without context, "smart contract risk" without audit data. Each risk must be actionable.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 173 — buildDataSummary: Holders whale context + Ecosystem chains
- **Change:** Holders section now includes whale risk label (extreme/high/moderate/well-distributed). Added ECOSYSTEM section with chain count (highly multichain/multichain/cross-chain/single chain) and primary chain.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 174 — Quick report: Score dimension summary in context
- **Change:** Injected buildScoreSummary into quick report prompt user message for score orientation context. Consistent with Opus prompt structure.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 175 — buildOpusPrompt: project_summary 3-sentence structure
- **Change:** project_summary instruction now specifies 3-sentence structure: (1) what it IS with protocol type+chain, (2) key traction metric from data, (3) optional who uses it. No hype allowed.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 176 — validateReport: section_confidence auto-calibration
- **Change:** section_confidence is now auto-capped based on data availability: fundamentals capped at 60 without onchain data, market_sentiment capped at 45 without social data, outlook capped at 40 without either. Overall is recalculated as weighted average if reported value is unrealistically high.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 177 — Quick report: Strengthened anti-hallucination rules
- **Change:** Rewrote quick report anti-hallucination block with "VIOLATIONS = USELESS REPORT" header. Added explicit rule 5 banning X/Twitter sentiment invention (flagged as #1 hallucination vector). Strengthened all 10 rules.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 178 — buildOpusPrompt: Scoring calibration with downgrade/upgrade rules
- **Change:** Added data completeness to calibration header. Added explicit DOWNGRADE rules (cap at HOLD if completeness <40%, cap at AVOID if critical red flags). Added UPGRADE rule (only upgrade if specific qualitative catalyst found in data).
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 179 — buildOpusPrompt: Composite indexes block
- **Change:** Added COMPOSITE INDEXES section to Opus user message extracting market_efficiency_score, onchain_maturity_score, dev_quality_index, social_health_index, liquidity_risk_score from scoring output. Gives LLM normalized 0-100 summaries.
- **Files:** `synthesis/llm.js`
- **Tests:** 164/164 pass

### Round 180 — Tests: buildScoreSummary + buildDataSummary test coverage
- **Change:** Added 8 new tests for buildScoreSummary (valid scores, OVERALL label, empty scores, dimension labels) and buildDataSummary (empty data, P/TVL ratio, revenue capture, data gaps). Total tests: 172/172.
- **Files:** `test/llm-opus.test.js`
- **Tests:** 172/172 pass

### Round 181 — Commit R151-180
- **Commits:** fd51cdd (R151-160), 60f5f7d (R161-170), 722310b (R171-180). Pushed to main.

## AutoResearch Data Collectors Batch — 30 Rounds (2026-03-26 03:45 UTC)

**Focus:** Collector robustness, NaN/Infinity guards, error messages, new data fields, scoring integration.

### Round 182 — market.js: safeNum() NaN/Infinity guard on derived metrics
- **Change:** Added `safeNum()` helper; applied to all division-derived fields (athDistancePct, circulatingToMaxRatio, volumeToMcapRatio) to prevent NaN/Infinity from propagating.
- **Files:** `collectors/market.js`
- **Tests:** 172/172 pass

### Round 183 — onchain.js: computePctChange NaN/Infinity guard
- **Change:** Added `Number.isFinite(result)` guard in `computePctChange()` to return null instead of NaN/Infinity for extreme TVL swings.
- **Files:** `collectors/onchain.js`
- **Tests:** 172/172 pass

### Round 184 — tokenomics.js: pct_circulating clamped to [0, 100]
- **Change:** `pct_circulating` now clamped to `[0, 100]` with NaN/Infinity guard — prevents CoinGecko rounding artifacts (>100%) from inflating tokenomics score.
- **Files:** `collectors/tokenomics.js`
- **Tests:** 172/172 pass

### Round 185 — dexscreener.js: volume_to_liquidity_ratio field
- **Change:** Added `volume_to_liquidity_ratio` (24h vol / total liquidity) — measures capital efficiency of DEX pairs; >1.0 = high velocity.
- **Files:** `collectors/dexscreener.js`
- **Tests:** 172/172 pass

### Round 186 — fetch.js: DOMAIN_COOLDOWN_MS/FAIL_THRESHOLD env-var tuning
- **Change:** Domain cooldown and failure threshold now configurable via `DOMAIN_COOLDOWN_MS` and `DOMAIN_FAIL_THRESHOLD` env vars (defaults: 60s, 3 failures).
- **Files:** `collectors/fetch.js`
- **Tests:** 172/172 pass

### Round 187 — github.js: retry on 403/429 with Retry-After respect
- **Change:** Replaced simple `fetchJson` with retry-aware version that handles GitHub rate limiting (403/429) with `Retry-After` header and `X-RateLimit-Reset` respect.
- **Files:** `collectors/github.js`
- **Tests:** 172/172 pass

### Round 188 — onchain.js: fees_7d null guard for multiple DeFiLlama response shapes
- **Change:** DeFiLlama fees API response now tried across multiple known array fields (`totalDataChart`, `totalDataChartBreakdown`, `data`); fallbacks to `total7d` and `total24h×7`; NaN sanitized.
- **Files:** `collectors/onchain.js`
- **Tests:** 172/172 pass

### Round 189 — index.js: per-collector age_ms in metadata
- **Change:** `collectorsInfo` now includes `age_ms` per collector for cache diagnostic visibility (was missing from metadata before).
- **Files:** `collectors/index.js`
- **Tests:** 172/172 pass

### Round 190 — market.js: description + homepage from CoinGecko
- **Change:** Added `description` (HTML-stripped, max 500 chars) and `homepage` URL from `coinData.links.homepage`. Zero API cost — already in the coin data response.
- **Files:** `collectors/market.js`
- **Tests:** 172/172 pass

### Round 191 — github.js: pre-populate repo_url from known mappings in fallback
- **Change:** `createEmptyGithubResult()` now pre-populates `repo_url` from `github-repos.json` when a mapping exists — so callers always have a URL for known protocols even when the API fails.
- **Files:** `collectors/github.js`
- **Tests:** 172/172 pass

### Round 192 — social.js: informative error with failure count + first error message
- **Change:** Replaced binary "All Exa queries failed" with a structured error: "All N queries failed (e.g. [first error])" or "N/M queries failed (partial data)".
- **Files:** `collectors/social.js`
- **Tests:** 172/172 pass

### Round 193 — tokenomics.js: error includes tried slugs for debugging
- **Change:** When Messari fails entirely, error message now includes the first 4 slugs tried (e.g. "tried: ethereum, eth, ethereum…") to make debugging faster.
- **Files:** `collectors/tokenomics.js`
- **Tests:** 172/172 pass

### Round 194 — onchain.js: error includes best-match name + score
- **Change:** "DeFiLlama protocol not found" now includes the best candidate name and score (e.g. "best match: \"ethereum\" score=45") to debug borderline cases.
- **Files:** `collectors/onchain.js`
- **Tests:** 172/172 pass

### Round 195 — dexscreener.js: informative no-pairs error
- **Change:** "No DEX pairs found" now distinguishes between "0 pairs returned" vs "unexpected API response format".
- **Files:** `collectors/dexscreener.js`
- **Tests:** 172/172 pass

### Round 196 — github.js: commit_frequency (commits/week)
- **Change:** Added `commit_frequency` field = commits_90d / 13 (avg commits/week over 90d window) — normalizes dev pace across repos of different ages.
- **Files:** `collectors/github.js`
- **Tests:** 172/172 pass

### Round 197 — market.js: price_change_pct_90d from actual chart data
- **Change:** `price_change_pct_90d` now computed from first/last price in 90-day chart history; falls back to weighted blend of 60d+200d only when chart unavailable. More accurate than heuristic.
- **Files:** `collectors/market.js`
- **Tests:** 172/172 pass

### Round 198 — dexscreener.js: top_pair_address + top_pair_chain
- **Change:** Added `top_pair_address` and `top_pair_chain` from top pair data — enables direct DexScreener URL construction.
- **Files:** `collectors/dexscreener.js`
- **Tests:** 172/172 pass

### Round 199 — onchain.js: fees_per_tvl_7d capital efficiency ratio
- **Change:** Added `fees_per_tvl_7d = fees_7d / tvl` — weekly fees divided by total TVL; higher = capital working harder. Complements revenue_efficiency.
- **Files:** `collectors/onchain.js`
- **Tests:** 172/172 pass

### Round 200 — onchain.js: protocol_age_days from DeFiLlama listedAt
- **Change:** Added `protocol_age_days` derived from DeFiLlama `listedAt` UNIX timestamp — gives the exact number of days since the protocol was listed.
- **Files:** `collectors/onchain.js`
- **Tests:** 172/172 pass

### Round 201 — market.js: reddit_subscribers from community_data
- **Change:** Added `reddit_subscribers` from CoinGecko `community_data` — already in the response, just wasn't being surfaced.
- **Files:** `collectors/market.js`
- **Tests:** 172/172 pass

### Round 202 — index.js: log collector errors to stderr per project
- **Change:** After metadata is built, each failed collector's error is logged to stderr with project name for observability: "[collectAll:projectName] collector X failed: message".
- **Files:** `collectors/index.js`
- **Tests:** 172/172 pass

### Round 203 — fetch.js: attach _fetchLatencyMs non-enumerable metadata
- **Change:** Added `_reqStart` timer; attaches `_fetchLatencyMs` as non-enumerable property to response objects — available for diagnostics without affecting JSON.stringify.
- **Files:** `collectors/fetch.js`
- **Tests:** 172/172 pass

### Round 204 — github.js: days_since_last_commit
- **Change:** Added `days_since_last_commit` derived from `last_commit.date` — instant staleness signal without needing to parse dates downstream.
- **Files:** `collectors/github.js`
- **Tests:** 172/172 pass

### Round 205 — market.js: volume_spike_flag (extreme_spike/spike/elevated)
- **Change:** Added `volume_spike_flag` comparing 24h volume vs 7d average: extreme_spike (>5x), spike (3-5x), elevated (1.5-3x). Null when no spike or insufficient data.
- **Files:** `collectors/market.js`
- **Tests:** 172/172 pass

### Round 206 — onchain.js: revenue_trend (improving/declining/flat)
- **Change:** Added `revenue_trend` comparing current 7d revenue vs prior 7d — improving (>15% increase), declining (<-15%), flat (within ±15%).
- **Files:** `collectors/onchain.js`
- **Tests:** 172/172 pass

### Round 207 — dexscreener.js: h6_volume_pct_of_24h intraday concentration
- **Change:** Added `h6_volume_pct_of_24h` = h6 volume / 24h volume × 100. High % = activity concentrated in recent 6 hours (breakout or news event signal).
- **Files:** `collectors/dexscreener.js`
- **Tests:** 172/172 pass

### Round 208 — tokenomics.js: unlock_risk_label combining overhang + team allocation
- **Change:** Added `unlock_risk_label` (critical/high/moderate/low) combining `unlock_overhang_pct` and vesting `team_allocation_pct` for a single-field unlock risk assessment.
- **Files:** `collectors/tokenomics.js`
- **Tests:** 172/172 pass

### Round 209 — Commit R182-208 + market.js community_score (0-100)
- **Commit:** 87a973e — 577 lines changed
- **Change:** Added `community_score` (0-100) using log-scale combination of Twitter followers, Telegram users, and Reddit subscribers.
- **Files:** `collectors/market.js`
- **Tests:** 172/172 pass

### Round 210 — github.js: has_recent_release
- **Change:** Added `has_recent_release` (boolean) = true when latest release was published within 90 days.
- **Files:** `collectors/github.js`
- **Tests:** 172/172 pass

### Round 211 — dexscreener.js: net_buy_pressure_pct
- **Change:** Added `net_buy_pressure_pct` = buys / (buys + sells) × 100. >55% = accumulation, <45% = distribution. More intuitive than buy/sell ratio.
- **Files:** `collectors/dexscreener.js`
- **Tests:** 172/172 pass

### Round 212 — circuit-breakers.js: DeFi TVL>50M + zero fees warning breaker
- **Change:** New warning circuit breaker: DeFi protocols with >$50M TVL generating zero fees get capped at 6.5 (value accrual mechanism may be broken).
- **Files:** `scoring/circuit-breakers.js`
- **Tests:** 172/172 pass

### Round 213 — social.js: avg_article_quality_score
- **Change:** Added `avg_article_quality_score` = mean domain trust score across all articles. 1.0 = average quality; 1.4 = tier-1 dominated coverage.
- **Files:** `collectors/social.js`
- **Tests:** 172/172 pass

### Round 214 — market.js: contract_addresses per-chain dict
- **Change:** Added `contract_addresses` dict from CoinGecko `platforms` field — maps chain names to contract addresses for all chains where the token is deployed.
- **Files:** `collectors/market.js`
- **Tests:** 172/172 pass

### Round 215 — github.js: contributor_bus_factor
- **Change:** Added `contributor_bus_factor` (critical/high/moderate/healthy) based on top contributor's commit share — critical when 1 person = 80%+ of commits.
- **Files:** `collectors/github.js`
- **Tests:** 172/172 pass

### Round 216 — scoring.js: commit_frequency + bus_factor in dev score
- **Change:** `scoreDevelopment` now uses `commit_frequency` for a smoothed dev pace signal (±0.15-0.3) and applies `contributor_bus_factor` penalty (−0.25 high, −0.5 critical).
- **Files:** `synthesis/scoring.js`
- **Tests:** 172/172 pass

### Round 217 — scoring.js: volume_spike_flag in risk score
- **Change:** `scoreRisk` now applies tiered penalties from `volume_spike_flag`: extreme_spike −0.6, spike −0.3. Reinforces the existing 7d avg spike detection.
- **Files:** `synthesis/scoring.js`
- **Tests:** 172/172 pass

### Round 218 — scoring.js: revenue_trend in onchain health score
- **Change:** `scoreOnchainHealth` now applies ±0.3 adjustment from `revenue_trend` — improving revenue = bullish fundamental, declining = structural concern.
- **Files:** `synthesis/scoring.js`
- **Tests:** 172/172 pass

### Round 219 — alpha-signals.js: volume_spike + buy_pressure breakout + revenue_momentum
- **Change:** Added `volume_spike_buy_pressure` signal (spike + net buy = potential breakout) and `revenue_momentum` signal (improving revenue + high efficiency = fundamentals strengthening).
- **Files:** `services/alpha-signals.js`
- **Tests:** 172/172 pass

### Round 220 — red-flags.js: high_unlock_overhang from unlock_risk_label
- **Change:** Added `high_unlock_overhang` red flag using `tokenomics.unlock_risk_label === 'critical'` — catches critical unlock risk via the composite label when individual fields aren't available.
- **Files:** `services/red-flags.js`
- **Tests:** 172/172 pass

### Round 221 — Commit R209-221 + llm.js: net_buy_pressure_pct + volume_to_liquidity in DEX block
- **Commit:** c522e7b — 141 lines changed
- **Change:** `buildDataSummary` DEX section now includes `net_buy_pressure_pct` (with accumulation/distribution label) and `volume_to_liquidity_ratio` (with capital efficiency label).
- **Files:** `synthesis/llm.js`
- **Tests:** 172/172 pass

### Round 222 — market.js: ath_recency field
- **Change:** Added `ath_recency` (recent_ath/near_ath/moderate_ath/old_ath) from `ath_date` — single-field assessment of whether the ATH was set recently or years ago.
- **Files:** `collectors/market.js`
- **Tests:** 177/177 pass

### Round 223 — github.js: open_prs_count
- **Change:** Added 9th parallel API call to `collectGithub` fetching open PRs count via Link header — signals active development pipeline depth.
- **Files:** `collectors/github.js`
- **Tests:** 177/177 pass

### Round 224 — market.js: coin_age_days from genesis_date
- **Change:** Added `coin_age_days` computed from `coinData.genesis_date` — quick age signal for age-based risk/maturity assessment without date parsing downstream.
- **Files:** `collectors/market.js`
- **Tests:** 177/177 pass

### Round 225 — llm.js: ath_recency + community_score + volume_spike in market block
- **Change:** `buildDataSummary` market section now surfaces ATH recency label, community score with context, and volume spike warning when present.
- **Files:** `synthesis/llm.js`
- **Tests:** 177/177 pass

### Round 226 — index.js: per-collector latency_ms tracking
- **Change:** Added `timedCollect()` wrapper; each collector records its start time; `collectorsInfo` now includes `latency_ms` per collector for performance diagnostics.
- **Files:** `collectors/index.js`
- **Tests:** 177/177 pass

### Round 227 — market.js: price_momentum_score (0-100) composite
- **Change:** Added `price_momentum_score` (0-100) using sigmoid normalization across 1h/24h/7d/30d changes (weights: 15/25/30/30). 100 = perfectly positive all timeframes.
- **Files:** `collectors/market.js`
- **Tests:** 177/177 pass

### Round 228 — test: 5 new collector field coverage tests (177/177)
- **Change:** Added tests for community_score, volume_spike_flag, net_buy_pressure_pct, revenue_trend, and pct arithmetic validation. Total: 177 tests.
- **Files:** `test/llm-opus.test.js`
- **Tests:** 177/177 pass

### Round 229 — onchain.js: fees_30d_actual from real 30d sum
- **Change:** `fees_30d` now prefers actual 30d sum from DeFiLlama data array; falls back to 7d×4.3 estimate only when insufficient history. Added `fees_30d_actual` field for explicitness.
- **Files:** `collectors/onchain.js`
- **Tests:** 177/177 pass

### Round 230 — alpha-signals.js: veteran_protocol_strong_fees signal
- **Change:** Added `veteran_protocol_strong_fees` signal: protocols 2+ years old with >$500K/week fees = battle-tested product-market fit. Uses new `protocol_age_days` field.
- **Files:** `services/alpha-signals.js`
- **Tests:** 177/177 pass

### Round 231 — Commit R222-230 (Final)
- **Commits:** ece354a. Pushed to main. Total: 177/177 tests. Net new lines: ~868 across 3 commits.

### Round 232 — templates.js: headline + composite_alpha_index nel text report
- **Change:** Aggiunte headline e composite_alpha_index dopo Collector failures, prima di Key Metrics nel text report. Migliora visibilità informazioni sintetiche top-level.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 233 — templates.js: red_flags_summary nel text report
- **Change:** Aggiunto red_flags_summary dopo Catalysts. Espone total/critical/warnings/risk_level in modo compatto.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 234 — templates.js: trade setup nel text report
- **Change:** Aggiunto trade_setup alla fine del text report (dopo investment thesis) usando renderTradeSetup().
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 235 — templates.js: elevator_pitch nel text report
- **Change:** Aggiunto elevator_pitch prima di Investment Thesis. Migliora sintesi top-level del progetto.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 236 — templates.js: conviction score nel text report
- **Change:** Aggiunto conviction score/label nei Key Metrics, dopo Overall Score.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 237 — templates.js: data quality tier nel text report
- **Change:** Aggiunto data_quality summary (tier/coverage_pct/completeness_pct) dopo Collector failures.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 238 — templates.js: key_findings count + alpha signals nel text report
- **Change:** Aggiunto count a Key Findings header, e sezione Alpha Signals (top 5) dopo i key findings.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 239 — templates.js: composite_alpha_index nell'HTML header
- **Change:** Aggiunto Alpha Index badge nell'header HTML, dopo volatileRegimeBadge.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 240 — templates.js: red flags summary section nell'HTML
- **Change:** Aggiunta sezione Risk Summary nell'HTML, dopo scores e prima di moat/risks/catalysts. Mostra solo se red_flags_summary.total > 0.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 241 — templates.js: investment thesis cards nell'HTML
- **Change:** Aggiunte 3 thesis cards (bull/bear/neutral) nell'HTML dopo competitor comparison. Grid responsive.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 241 — Commit R232-241
- **Commit:** c9aebab. Pushed to main. Tests: 177/177.

### Round 242 — templates.js: conviction meter nelle key metrics HTML cards
- **Change:** Aggiunta conviction card nelle key metrics HTML (score/100 + label) se disponibile.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 243 — templates.js: trade setup section nell'HTML
- **Change:** Aggiunta sezione Trade Setup nell'HTML dopo Analysis, usando renderTradeSetup().
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 244 — templates.js: elevator pitch section nell'HTML
- **Change:** Aggiunto banner Elevator Pitch nell'HTML prima di Analysis. Gradient background per visibilità.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 245 — templates.js: fmtPct() helper + price_change in extractKeyMetrics
- **Change:** Aggiunto helper fmtPct(). Aggiunti price_change_24h/7d e i relativi _fmt in extractKeyMetrics.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 246 — templates.js: price_change card nell'HTML key metrics
- **Change:** Aggiunta card 24h Change nelle key metrics HTML con colore verde/rosso dinamico.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 247 — templates.js: price_change nel text report key metrics
- **Change:** Aggiunte righe 24h Change e 7d Change nei Key Metrics del text report.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 248 — templates.js: formatAgentJSON — aggiungi composite_alpha_index, elevator_pitch, red_flags_summary
- **Change:** Calcolo composite_alpha_index e red_flags_summary in formatAgentJSON, aggiunti campi elevator_pitch, composite_alpha_index, red_flags_summary nell'output JSON.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 249 — routes/alpha-history.js: /alpha/export — aggiungi conviction + composite_alpha_index + data_quality
- **Change:** Aggiunti conviction, composite_alpha_index, data_quality nell'exportPayload di /alpha/export.
- **Files:** routes/alpha-history.js
- **Tests:** 177/177 pass

### Round 250 — routes/alpha-history.js: /alpha/export — formatted_metrics + thesis_summary
- **Change:** Aggiunti formatted_metrics (price_fmt, market_cap_fmt, ecc) e thesis_summary (one_liner, bull/bear case) nell'exportPayload.
- **Files:** routes/alpha-history.js
- **Tests:** 177/177 pass

### Round 250 — Commit R242-250
- **Commit:** 5b1efac. Pushed to main. Tests: 177/177.

### Round 251 — routes/mcp.js: alpha_research — usa formatAgentJSON per structuredContent
- **Change:** Import formatAgentJSON, usato in alpha_research tool MCP per structuredContent invece di formatted.json + report_html.
- **Files:** routes/mcp.js
- **Tests:** 177/177 pass

### Round 252 — routes/mcp.js: alpha_research — aggiungi preamble nel text
- **Change:** Aggiunto preamble compatto in alpha_research text output: verdict, score, alpha index, conviction.
- **Files:** routes/mcp.js
- **Tests:** 177/177 pass

### Round 253 — routes/mcp.js: x_sentiment — aggiungi trending_topics + engagement stats
- **Change:** Aggiunti trending_topics, engagement_level, fear_greed_signal in x_sentiment tool MCP. Cambiato filter da Boolean a null check.
- **Files:** routes/mcp.js
- **Tests:** 177/177 pass

### Round 254 — routes/mcp.js: trading_signals — aggiungi summary stats header
- **Change:** Aggiunto header con bullish/bearish count, total signals, hours in trading_signals MCP tool.
- **Files:** routes/mcp.js
- **Tests:** 177/177 pass

### Round 255 — templates.js: renderScoreLine — mostra confidence label
- **Change:** renderScoreLine ora include confidence_label o confidence% tra parentesi quadre nel text report.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 256 — templates.js: HTML scores — colori basati sul valore
- **Change:** Aggiunto helper scoreColor(). Applicato colori dinamici (verde/giallo/rosso) alle scores nell'HTML, con confidence_label inline.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 257 — templates.js: formatReport JSON — aggiungi formatted_scores array
- **Change:** Aggiunto formatted_scores array nel json object di formatReport, con dimension, score, score_fmt, confidence, confidence_label per ogni dimensione.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 258 — routes/alpha-history.js: /alpha/export — score_summary
- **Change:** Aggiunto score_summary array nell'exportPayload con dimension, score, score_fmt per le 6 dimensioni principali.
- **Files:** routes/alpha-history.js
- **Tests:** 177/177 pass

### Round 259 — templates.js: fmtNumber — export fmtNumber e fmtPct come named exports
- **Change:** Aggiunti named exports per fmtNumber e fmtPct alla fine di templates.js. Util functions disponibili per import esterni.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 260 — templates.js: formatMarkdown — aggiungi elevator_pitch e composite_alpha_index
- **Change:** Aggiunti elevator_pitch (se presente) e conviction nel markdown output header.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 261 — Bump engine_version + Final commit
- **Change:** Bump engine_version da r44-2026-03-25 a r61-2026-03-26.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 261 — Commit R251-261
- **Commit:** 829eb3e. Pushed to main. Tests: 177/177.

## Experiment 22 — SCORE_MOMENTUM: velocity metric
- **Hypothesis:** Signal importance correlates with how fast score changes (pts/hour), not just absolute delta.
- **Change:** Added `velocity` field (delta/hours) to SCORE_MOMENTUM signals; included in title and detail.
- **Files:** oracle/signal-detector.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Velocity adds temporal context to momentum signals.

## Experiment 23 — SCORE_MOMENTUM: trend_consistency flag
- **Hypothesis:** Momentum signal quality improves when direction is consistent across multiple snapshots.
- **Change:** Added trend_consistency boolean check (last 5 snapshots); flag shown in title/detail when true.
- **Files:** oracle/signal-detector.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Provides confidence in direction (not just single delta).

## Experiment 24 — SCORE_MOMENTUM: normalized_delta
- **Hypothesis:** Delta of 1.5 is more significant at score 4 than at score 8; normalized_delta captures relative change.
- **Change:** Added normalized_delta (delta / current_score) to SCORE_MOMENTUM data_json.
- **Files:** oracle/signal-detector.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Enables relative momentum comparison across different score levels.

## Experiment 25 — CATEGORY_LEADER_SHIFT: severity by change count
- **Hypothesis:** Complete top3 overhaul (3 new) is more significant than single token swap.
- **Change:** Severity = critical (3 new) | high (2 new) | medium (1 new); included change_count in data_json.
- **Files:** oracle/signal-detector.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Severity now scales with magnitude of leadership change.

## Experiment 26 — CATEGORY_LEADER_SHIFT: score_gap
- **Hypothesis:** Score gap between new/old #1 indicates strength of regime change (large gap = dominant new leader).
- **Change:** Added score_gap (new_leader_score - old_leader_score) to detail and data_json.
- **Files:** oracle/signal-detector.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Adds quality context to leadership shifts.

## Experiment 27 — BREAKER_ALERT: multiple breakers count + severity escalation
- **Hypothesis:** 3+ active breakers is critical risk; count provides context on token health.
- **Change:** Severity = critical (3+ breakers) | high (1-2); included breaker_count and all_breakers list in data_json.
- **Files:** oracle/signal-detector.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Severity escalates with breaker count; full list logged for analysis.

## Experiment 28 — BREAKER_ALERT: duration check + severity escalation
- **Hypothesis:** Breaker active >48h (3+ snapshots) indicates persistent structural issue; should escalate to critical.
- **Change:** Check last 4 snapshots; if breaker present in 2+ previous = long_duration → severity = critical.
- **Files:** oracle/signal-detector.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Persistent breakers flagged as critical; transient breakers remain high.

## Experiment 29 — DIVERGENCE: moderate divergence thresholds
- **Hypothesis:** Score 6.5/4.5 capture moderate divergence earlier; severity scale provides quality filter.
- **Change:** Lowered thresholds to 6.5 (positive) and 4.5 (negative); severity = high (extreme score ≥7.0/≤4.0), medium (moderate 6.5-7.0/4.0-4.5).
- **Files:** oracle/signal-detector.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Broader coverage with quality tier.

## Experiment 30 — DIVERGENCE: volume quality filter
- **Hypothesis:** Divergence on thin volume (<5% daily turnover) is less actionable; severity should downgrade.
- **Change:** Added volume_to_mcap calculation; low_volume flag downgrades high → medium severity.
- **Files:** oracle/signal-detector.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Volume context improves signal quality filtering.

## Experiment 31 — Alpha Signals: CONVICTION_SCORE composite
- **Hypothesis:** 5+ strong signals indicate high conviction; composite bonus rewards multiple confluent strong signals.
- **Change:** getSignalStrengthScore adds +10 bonus per strong signal beyond 4th when strongCount ≥ 5.
- **Files:** services/alpha-signals.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Multi-signal conviction rewarded in strength score.

## Experiment 32 — Alpha Signals: SUPPLY_SHOCK
- **Hypothesis:** Low circulating supply (<30% total) + low FDV/MCap (<2x) signals compressed float with low overhang.
- **Change:** Added supply_shock signal checking circulating_supply % and FDV/MCap ratio.
- **Files:** services/alpha-signals.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Identifies supply compression conditions early.

## Experiment 33 — Alpha Signals: CROSS_CHAIN_TVL_GROWTH
- **Hypothesis:** Simultaneous TVL growth across multiple chains signals broad capital migration, not single-chain flukes.
- **Change:** Added cross_chain_tvl_growth signal for 2+ chains growing >15% TVL in 7d.
- **Files:** services/alpha-signals.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Detects multichain momentum early.

## Experiment 34 — Trade Setup: volatility-adjusted entry zone
- **Hypothesis:** Entry zone should adapt to recent volatility — wider for volatile tokens, tighter for stable.
- **Change:** Entry spread = 3% (low vol <5%), 5% (normal), 8% (high vol >20%) based on |price_change_7d|.
- **Files:** services/trade-setup.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Entry zones adapt to market conditions.

## Experiment 35 — Trade Setup: dynamic SL based on volatility
- **Hypothesis:** Fixed -15% SL is too tight for volatile tokens, too wide for stable. Adapt to 7d price change.
- **Change:** SL = -10% (low vol <10%), -15% (normal), -25% (high vol >30%); ATL override if closer.
- **Files:** services/trade-setup.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. Stop losses adapt to token volatility profile.

## Experiment 36 — Trade Setup: Fibonacci TP targets
- **Hypothesis:** Fibonacci retracement levels (38.2%, 61.8%, 100% ATH) provide better technical TP targets than fixed % gains.
- **Change:** TP1/TP2/TP3 use Fibonacci ATL→ATH levels when available, fallback to % gains otherwise.
- **Files:** services/trade-setup.js
- **Test:** npm test → 177/177 pass
- **Result:** keeper. TP targets align with technical support/resistance levels.

## Experiment 37 — Deduplicate safeNum/safeNumber into utils/math.js
- **Hypothesis:** `safeNum()` in collectors/market.js and `safeNumber()` in synthesis/scoring.js are identical utility functions; consolidating them reduces code duplication and establishes a shared numeric utilities module.
- **Change:** Created `utils/math.js` with a single `safeNumber(value, fallback=0)` function; updated imports in `collectors/market.js` and `synthesis/scoring.js`; renamed all `safeNum(...)` calls in market.js to `safeNumber(...)`.
- **Files:** utils/math.js (new), collectors/market.js, synthesis/scoring.js
- **Test:** `npm test` → 177/177 pass
- **Result:** kept. Shared utility module established; deduplication successful.


## Experiment 38 — JSDoc on all public exports in utils/
- **Hypothesis:** Security and math utility exports lack documentation; JSDoc improves code navigability and IDE autocomplete support.
- **Change:** Added JSDoc to `secureCompare()` in `utils/security.js` (format.js and math.js already had JSDoc).
- **Files:** utils/security.js
- **Test:** `npm test` → 177/177 pass
- **Result:** kept. All utils/ public functions now documented.


## Experiment 39 — JSDoc on createExaService in services/exa.js
- **Hypothesis:** Public API exports without JSDoc reduce code navigability and IDE autocomplete support.
- **Change:** Added JSDoc to `createExaService()` documenting params and return type.
- **Files:** services/exa.js
- **Test:** `npm test` → 177/177 pass
- **Result:** kept. Public service factory now documented.


## 2026-03-26 — AutoResearch Nightly Batch (Round 237 series, 30 improvements)

### Overview
30-round autonomous improvement batch targeting collector accuracy, scoring refinements, red flag detection, frontend UX, cross-dimensional analysis, and new data signals.

### Improvements Implemented

1. **Social: `competitor_content_ratio`** — New field tracking what fraction of articles frame the project in competitor context. High ratio (>60%) signals secondary coverage, not primary narrative. Used in scoring and red flags.

2. **Red flags: `falling_social_velocity`** — Fires when news_momentum is 'declining' AND sentiment_score < -0.2. Combination of declining coverage + bearish tone = fading narrative. Also added `secondary_coverage_only` info flag.

3. **Alpha signals: `community_score_leader`, `news_acceleration`, `governance_activity`** — Three new signals: top CoinGecko community score (>70), accelerating news coverage (>3 articles in 3 days), and active DAO governance (≥3 mentions).

4. **Circuit breakers: `zero_volume_high_mcap`, `no_github_large_cap`** — Zero 24h volume with high market cap triggers CRITICAL cap (4.0). No GitHub on >$50M cap token (non-meme) triggers WARNING cap (6.5).

5. **DexScreener: `sell_wall_risk`** — Composite signal detecting sell walls: high sell dominance + concentrated pool + accelerating volume = 'high' / 'elevated' / null. Used in scoring, LLM prompt, circuit breakers, and UI.

6. **Scoring social: `competitor_content_ratio` penalty** — When 50%+ of social coverage is competitor-framing, raw score penalized by up to -0.4.

7. **Market: `holder_engagement_score`** — New 0-100 composite combining volume/mcap velocity (50pts), community following (30pts), and trending bonus (20pts). Added to templates, UI metrics table, conviction scoring.

8. **LLM prompt: sell wall risk context block** — When DEX sell_wall_risk is 'elevated' or 'high', a dedicated ## SELL WALL RISK block appears in Opus prompt with actionable context for bear case.

9. **Report quality: sell wall + social credibility** — Adds issues for high sell wall risk and low social credibility + declining momentum, with score deduction.

10. **Templates: sell wall + holder engagement in text report** — Text report now shows ⚠️ Sell Wall Risk: HIGH/ELEVATED and Holder Engagement: X/100 in key metrics section.

11. **Reddit: upvote-weighted sentiment + `reddit_activity_score`** — Reddit sentiment now blends raw counts (60%) with log-scale upvote weights (40%). New `reddit_activity_score` (0-100) combines post count, upvote weight, recency, and subreddit diversity. Used in social scoring and confidence.

12. **Scoring distribution: `sell_wall_risk` penalty** — Applied directly in calculateScores() via distribution.score -= 0.6/0.3 for high/elevated sell wall risk.

13. **GitHub: `bus_factor_score`** — Gini-coefficient based (0-100) continuous score for contribution distribution. More nuanced than the categorical label. Used in dev dimension scoring.

14. **Dev scoring: `bus_factor_score` supplement** — Uses continuous Gini score to fine-tune dev dimension: <30 = penalty, >70 = bonus (only when label not already applied).

15. **Narrative momentum: 2026 AI narratives** — Added 5 new narrative clusters: `agent_commerce` (x402/A2A/MCP), `bitcoin_mainstream` (strategic reserve), `base_ecosystem`, `hyper_liquid` (Hyperliquid perps), `rwa_tokenization` (tokenized real estate/bonds).

16. **Social confidence: `reddit_activity_score` boost** — When reddit_activity_score ≥ 30, socialConf += 10, improving confidence on well-discussed tokens.

17. **LLM fact registry: 5 new facts** — Added holder_engagement_score, reddit_activity_score, competitor_content_ratio, sell_wall_risk, bus_factor_score to fact registry for LLM grounding.

18. **LLM data summary: sell wall risk in DEX section** — When sell_wall_risk is elevated/high, surfaces it prominently in the DEX section with ratio and volume momentum context.

19. **LLM data summary: engagement metrics block** — New ENGAGEMENT METRICS section shows holder_engagement_score and reddit_activity_score with human-readable labels when available.

20. **Alpha signals: `distributed_dev_plus_active_shipping`** — Fires when bus_factor_score ≥ 75 AND has_recent_release = true. Signals well-distributed team actively shipping = reduced key-person risk.

21. **Onchain: `revenue_per_active_user` + `active_addresses_7d`** — New product-market fit metric: daily revenue / daily active users. Also adds `active_addresses_7d` derived from daily active users × 7 × 0.6 uniqueness factor.

22. **Onchain scoring: `revenue_per_active_user` signal** — ≥$1/user/day = +0.4, ≥$0.10 = +0.2, ≥$0.01 = +0.05, <$0.01 = -0.1.

23. **Conviction: `holder_engagement_score` + sell wall bonuses** — High holder engagement (+3/+1 conviction), sell wall risk (-3/-1). Also updated reasoning string with new factors.

24. **Cross-dimensional: `buy_pressure_quality` analysis** — New function `detectBuyPressureSocialDivergence()` that fires `smart_money_accumulation` (buy pressure + bearish social) and `distribution_under_bullish_cover` (sell pressure + bullish social) divergence signals.

25. **Temporal analysis: 3 new tracked metrics** — holder_engagement_score, dex_liquidity, and reddit_activity_score now tracked in temporal delta comparison across scans.

26. **Engine version bump** — Updated to r62-2026-03-26 in templates.js to signal significant engine update.

27. **Frontend: sell wall risk badge** — Red/orange badge appears in price header area when sell_wall_risk is 'high' or 'elevated', shown before other badges.

28. **Frontend: 5 new market table rows** — holder_engagement_score, reddit_activity_score, bus_factor_score, sell_wall_risk, revenue_per_active_user all now appear in the market metrics table.

29. **Frontend: new red flag labels** — Added humanized labels for falling_social_velocity, secondary_coverage_only, no_github_large_cap, zero_volume_high_mcap, sell_pressure_dominance, ghost_contributors, old_ath_stagnation.

30. **Frontend: new alpha signal labels** — Added readable labels for news_acceleration, governance_activity, distributed_dev_plus_active_shipping, smart_money_accumulation, distribution_under_bullish_cover, community_score_leader.

### Files Modified
- `collectors/social.js` — competitor_content_ratio, competitor framing detection
- `collectors/reddit.js` — upvote-weighted sentiment, reddit_activity_score
- `collectors/dexscreener.js` — sell_wall_risk composite
- `collectors/github.js` — bus_factor_score (Gini-based)
- `collectors/market.js` — holder_engagement_score
- `collectors/onchain.js` — revenue_per_active_user, active_addresses_7d
- `services/red-flags.js` — falling_social_velocity, secondary_coverage_only, new circuit breaker signals
- `services/alpha-signals.js` — community_score_leader, news_acceleration, governance_activity, distributed_dev_plus_active_shipping, newsMomentum variable fix
- `services/report-quality.js` — sell wall + social credibility quality checks
- `services/narrative-momentum.js` — 5 new 2026 narrative clusters
- `synthesis/scoring.js` — competitor_content_ratio penalty, sell_wall_risk distribution, reddit_activity_score supplement, bus_factor_score, revenue_per_active_user, reddit_activity_score social confidence
- `synthesis/llm.js` — sell wall context in Opus prompt, 5 new facts, sell wall in DEX section, engagement metrics block
- `synthesis/templates.js` — sell wall + holder engagement in text report, engine version r62
- `scoring/circuit-breakers.js` — zero_volume_high_mcap, no_github_large_cap
- `analysis/cross-dimensional.js` — detectBuyPressureSocialDivergence()
- `analysis/temporal.js` — 3 new tracked metrics
- `analysis/conviction.js` — holder_engagement_score + sell wall conviction factors
- `public/js/alphascan.js` — sell wall badge, 5 new metric rows, new flag/signal labels

### Round 262 — Smooth hover transitions su bottoni CTA
- **Change:** Uniformate le durate delle transizioni CSS su `.btn-primary` e `.btn-secondary` a 0.25s con `ease` timing. Aggiunta `background-color` nella transition list per rendere qualsiasi futuro stato hover/active più fluido.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 263 — Focus state su product cards per accessibilità keyboard
- **Change:** Aggiunto `:focus-visible` state a `.product-card` con border e box-shadow dedicati (più visibili di :hover) per migliorare la navigazione da tastiera. L'outline nativo è disabilitato per evitare doppio bordo.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 264 — Miglioramento contrasto badge "coming soon"
- **Change:** Badge `.product-tag.dim` ora usa `var(--muted2)` invece di `var(--muted)` per migliorare il contrasto su dark background (#9a9a9a vs #7e7e7e).
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 265 — Line-height ottimizzato per hero headline
- **Change:** `h1.hero-headline` ora usa `line-height: 1.12` (era 1.08) per migliorare la leggibilità, specialmente su schermi piccoli dove il font è più grande rispetto al viewport.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 266 — Letter-spacing su section-sub per uniformità
- **Change:** Aggiunto `letter-spacing: -0.01em` a `.section-sub` per allinearlo alla tipografia del resto della pagina (title ha -0.04em, questo è più leggero per body text).
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 267 — Hover effect nav links più smooth
- **Change:** `nav a` ora transiziona anche `opacity` (oltre a `color`) con timing uniformato a 0.25s ease.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 268 — Transition smooth su header background al scroll
- **Change:** `header` ora transiziona anche `background-color` (oltre a `border-color`) quando riceve la classe `.scrolled` via JS.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 269 — Smooth transform su API code block copy button
- **Change:** `.code-copy-btn` ora transiziona `background-color`, e aggiunto `transform: translateY(-1px)` al `:hover` per feedback visivo più chiaro.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 270 — Hover shimmer effect più fluido su .api-note
- **Change:** `.api-note` ora transiziona anche `transform` e solleva leggermente su `:hover` con `translateY(-2px)` per feedback tattile.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 271 — Focus state su bottoni footer social
- **Change:** Link `.footer-links a` ora hanno `:focus-visible` state con outline verde e underline attivo, per navigazione keyboard.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 272 — Colore aragosta più saturo sui pill badge attivi
- **Change:** `.product-tag` attivo ora usa `#E8721A` (più saturo e luminoso) invece di `var(--green)` (#D4580A). Border anche più visibile (opacity 0.3 vs 0.22).
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 273 — Miglioramento padding e spacing su .btn-card
- **Change:** `.btn-card` ora ha padding `11px 20px` (più equilibrato), gap `7px`, e transition uniformata a 0.25s. Aggiunto `transform: translateY(-1px)` su `:hover`.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 274 — Font-size hero-sub più grande su desktop
- **Change:** `.hero-sub` ora usa `clamp(1rem, 2vw, 1.25rem)` (max era 1.2rem) e `max-width: 620px` (era 600px) per migliorare la leggibilità su schermi grandi.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 275 — Border-radius più coerente su tutti i box
- **Change:** Aggiunta variabile CSS `--radius-xs: 8px` e rimpiazzati tutti i `border-radius: 8px` hardcoded con `var(--radius-xs)` per uniformità.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 276 — Smooth opacity transition su code syntax highlight
- **Change:** Elementi syntax highlight nel code block (`.comment`, `.key`, `.val`, `.str`, `.green`) ora hanno `transition: color 0.2s ease` per smooth theme switching futuro.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 277 — AlphaScan: migliorare leggibilità radar chart labels
- **Change:** Label assi radar chart ora usano `font-size="12.5"` (era 11.5), `font-weight="650"` (era 600), e `fill="#d8d8d8"` (era #c8c8c8) per maggiore leggibilità.
- **Files:** public/js/alphascan.js
- **Tests:** 177/177 pass

### Round 278 — Colore grid radar più contrastato
- **Change:** Grid radar chart usa opacity aumentata (base 0.08 invece di 0.06, incremento 0.03 invece di 0.025). Score ticks ora `fill="rgba(232,232,232,0.5)"` (era 0.4) e `font-size="10"` (era 9.5).
- **Files:** public/js/alphascan.js
- **Tests:** 177/177 pass

### Round 279 — Stroke width assi radar più spesso per visibilità
- **Change:** Assi radar chart ora `stroke-width="1.2"` (era 1) e `stroke="rgba(232,232,232,0.15)"` (era 0.12) per maggiore presenza visiva.
- **Files:** public/js/alphascan.js
- **Tests:** 177/177 pass

### Round 280 — Spacing più ampio tra section blocks
- **Change:** `section` padding portato a `90px 0` (era 80px) per dare più respiro verticale su desktop.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 281 — Miglioramento Open Graph image meta tag
- **Change:** Aggiunti `og:image:width`, `og:image:height`, e `twitter:image` per migliorare la preview social (dimensioni standard 1200x630).
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 282 — Structured data JSON-LD per SEO
- **Change:** Aggiunto JSON-LD structured data (schema.org `SoftwareApplication`) per migliorare SEO e rich snippet Google.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 283 — Canonical URL meta tag
- **Change:** Aggiunto `<link rel="canonical" href="https://clawnkers.com/">` per evitare duplicati SEO.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 284 — Preload font files per performance
- **Change:** Aggiunto `<link rel="preload">` per il font Inter (woff2) per ridurre il tempo di render bloccante.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 285 — Meta theme-color per mobile browser
- **Change:** Aggiunto `<meta name="theme-color" content="#0a0a0a">` per colorare la status bar mobile (Android Chrome, Safari iOS).
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 286 — Manifest.json PWA icons completi
- **Change:** Creato `public/manifest.json` per PWA con icon reference (192x192, 512x512). Aggiunto `<link rel="manifest">` in HTML.
- **Files:** public/manifest.json, public/index.html
- **Tests:** 177/177 pass

### Round 287 — Service worker cache strategy ottimizzata
- **Change:** Aggiornato `CACHE_NAME` a `clawnkers-v2-2026-03` con comment per forzare refresh su deploy. Nessun cambio di logica, solo versioning.
- **Files:** public/sw.js
- **Tests:** 177/177 pass

### Round 288 — Responsive font-size hero-badge mobile
- **Change:** `.hero-badge` ora usa `font-size: clamp(0.78rem, 1.8vw, 0.85rem)` (era 0.82rem fisso) per adattarsi meglio su schermi piccoli/grandi.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 289 — Hover su logo header più smooth
- **Change:** Logo header ora ha transition su `transform` e `filter`. Al `:hover` applica leggera rotazione (-3deg), scale (1.05), e saturazione aumentata per feedback visivo.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 290 — Smooth fade-in animation più fluida
- **Change:** `.fade-in` ora usa `cubic-bezier(0.16, 1, 0.3, 1)` (easing più naturale) e durata `0.7s` (era 0.6s ease) per animazioni d'ingresso più eleganti.
- **Files:** public/index.html
- **Tests:** 177/177 pass

---
## Batch UX & Layout — Round 291–320 (AutoResearch 00:30, 2026-03-27)
Focus: responsive layout, spacing, typography, loading states, animations, accessibility.

### Round 291 — Score label overflow su <400px
- **Change:** `.score-label` overflow:hidden, `.score-label span` display:none su schermi < 400px per evitare overflow del subtitle dei punteggi.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 292 — Scanner form section padding fluido
- **Change:** `.scanner-form-section` usa `clamp(28px, 5vw, 48px)` invece di padding fisso 48px. Più compatto su mobile.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 293 — Stats grid auto-fit fluido
- **Change:** `.stats-grid` passa da `repeat(3, 1fr)` fisso a `repeat(auto-fit, minmax(min(200px,100%), 1fr))`. Tablet responsive senza media query.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 294 — Bull/bear grid auto-fit
- **Change:** `.bull-bear-grid` passa a `repeat(auto-fit, minmax(min(280px,100%), 1fr))`. Elimina hard breakpoint a 768px.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 295 — How-grid auto-fit
- **Change:** `.how-grid` passa a `repeat(auto-fit, minmax(min(220px,100%), 1fr))`. 3→2→1 col fluido senza media query esplicite.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 296 — Fluid section padding
- **Change:** `section { padding: clamp(48px, 8vw, 80px) 0; }` — si restringe proporzionalmente su tutti i breakpoint.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 297 — Card padding fluid
- **Change:** `.card { padding: clamp(12px, 2vw, 16px); }` — più compatto su mobile.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 298 — Score row label width fluid
- **Change:** `.score-row` grid columns da `110px 1fr 60px` fisso a `minmax(100px,130px) 1fr minmax(50px,65px)` per adattarsi meglio a diverse larghezze.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 299 — Panel padding fluid
- **Change:** `.panel { padding: clamp(16px, 2.5vw, 28px); }` — più breathing room su desktop, compatto su mobile.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 300 — Results container gap con CSS grid
- **Change:** `.results-container #report` ora usa `display: grid; gap: 18px` per verticalizzare i panel con gap uniforme.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 301 — Analysis text readability
- **Change:** `.analysis` font-size `clamp(0.88rem, 1.6vw, 0.97rem)`, line-height 1.9, `max-width: 72ch` per lunghezza riga ottimale.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 302 — Score label font weight e sizing
- **Change:** `.score-label strong` font-size 0.9rem e font-weight 600; `.score-label span` font-weight 500 per migliore gerarchia visiva.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 303 — Thesis text contrast migliorato
- **Change:** `.thesis` colore da `var(--text)` a `#d6d6d6` (più leggibile su sfondo scuro), line-height 1.75.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 304 — Table header e dati più leggibili
- **Change:** `.table th` colore `#8e8e8e` (più visibile), font-weight 600, font-size 0.82rem. `.table td` colore `#d4d4d4` e font-size 0.9rem.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 305 — Sub-labels con divisore bottom
- **Change:** `.sub-label` ha `padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.05)` per separare le sezioni bull/bear.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 306 — Results section scroll-margin-top
- **Change:** `#results-section { scroll-margin-top: 72px }` per evitare che lo sticky header copra il contenuto quando si scrolla ai risultati.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 307 — Skeleton panel padding fluid
- **Change:** `.skeleton-panel { padding: clamp(16px, 2.5vw, 28px) }` allineato con `.panel` per coerenza visiva tra stato loading e stato risultati.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 308 — Skeleton lines proporzioni realistiche
- **Change:** Dimensioni skeleton aggiornate: title 40px (era 44px), badge 34px/26% (era 36px/28%), skeleton-bar 11px (era 10px). Aggiunta variante `.w-90`.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 309 — Loading wrap più largo
- **Change:** `.loading-wrap { width: min(640px, 100%) }` (era 560px). Gap tra elementi 10px (era 8px). Loading dots gap 6px.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 310 — Status box min-height per anti-CLS
- **Change:** `.status:not(:empty) { min-height: 80px }` previene layout shift quando la loading bar appare.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 311 — Results reveal easing spring
- **Change:** `resultsReveal` usa `cubic-bezier(0.16, 1, 0.3, 1)` (spring easing), durata 0.6s (era 0.55s). Y offset 22px (era 18px) per reveal più drammatico.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 312 — Panel stagger easing aggiornato
- **Change:** `panelSlideIn` per `#report .panel` usa `cubic-bezier(0.16, 1, 0.3, 1)`. Delays leggermente ridotti (0.03s–0.33s).
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 313 — PanelSlideIn Y offset
- **Change:** `panelSlideIn` from: `translateY(16px) scale(0.993)` (era 14px/0.995) per slide-in più percettibile.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 314 — Score bar fill spring easing
- **Change:** `.bar > span` animation usa `cubic-bezier(0.16, 1, 0.3, 1)` e durata 0.9s (era 1s ease). Barre che si riempiono con feeling più naturale.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 315 — Card hover transition consistente
- **Change:** `.card` e `.score-row` hanno `transition` esplicita per hover. `.card:hover` aggiunge `transform: translateY(-1px)`. Hover states più coerenti.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 316 — Payment overlay overscroll-behavior
- **Change:** `.payment-overlay { overscroll-behavior: contain }` previene scroll bleed sotto il modal di pagamento.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 317 — Pay button WCAG AA contrast
- **Change:** `.pay-btn` colore `#f5a56b` (più chiaro/contrastato su sfondo scuro), `min-height: 52px` per touch target, `font-weight: 600`.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 318 — Dex dropdown item touch target + focus
- **Change:** `.dex-item { min-height: 48px }` per touch comfort. Aggiunto `:focus-visible` con outline arancione per accessibilità keyboard.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 319 — Products grid auto-fit (index.html)
- **Change:** `.products-grid` da `repeat(3, 1fr)` a `repeat(auto-fit, minmax(min(280px,100%), 1fr))` per layout fluido senza media query.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 320 — Testimonial footer con accent line (index.html)
- **Change:** `.testimonial-card footer` ora ha `display:flex; gap:6px` con `::before` che inserisce una linea arancione di 16px prima del testo. Attribuisce più peso visivo alle citazioni.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 321 — Rescan button touch target e hover lift
- **Change:** `.rescan-btn { min-height: 40px; display:inline-flex; align-items:center; gap:6px }` + hover `transform: translateY(-1px)`.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 322 — Hero note layout flex
- **Change:** `.hero-note` diventa flex con `justify-content:center; gap:6px; flex-wrap:wrap` per allineare icone e testo su più righe.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 323 — How-step focus-visible keyboard nav
- **Change:** `.how-step:focus-visible` con box-shadow arancione, outline:none e transform per accessibilità keyboard.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 324 — Verdict badge pop animation
- **Change:** `.verdict` ha `animation: verdictPop 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both` — scala da 0.8 a 1 con delay per reveal drammatico dopo il report.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 325 — Project intro card visual hierarchy
- **Change:** `.project-intro-card` gradient migliorato (160deg, più scuro), border `rgba(212,88,10,0.2)`, `box-shadow: 0 4px 16px rgba(0,0,0,0.2)`, padding 18px/20px.
- **Files:** public/alphascan.html
- **Tests:** 177/177 pass

### Round 326 — Signal card hover (signals.html)
- **Change:** `.signal-card` aggiunto hover con `border-color: rgba(212,88,10,0.25); transform: translateY(-2px)` per coerenza con il design system.
- **Files:** public/signals.html
- **Tests:** 177/177 pass

### Round 327 — Stats hover lift (signals.html)
- **Change:** `.stat:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.25) }` per più feedback visivo.
- **Files:** public/signals.html
- **Tests:** 177/177 pass

### Round 328 — Filters touch-friendly + focus ring (signals.html)
- **Change:** Select/input filtri: `min-height: 40px`, `box-shadow: 0 0 0 3px rgba(212,88,10,0.12)` su focus, `border-color` su hover.
- **Files:** public/signals.html
- **Tests:** 177/177 pass

### Round 329 — Diff grid auto-fit (index.html)
- **Change:** `.diff-grid` da `repeat(3, 1fr)` a `repeat(auto-fit, minmax(min(240px,100%), 1fr))` per layout fluido.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 330 — will-change esteso a testimonial cards (index.html)
- **Change:** Aggiunto `.testimonial-card` a `will-change: transform` per hint GPU su hover animations.
- **Files:** public/index.html
- **Tests:** 177/177 pass

### Round 331 — Fix CATEGORY_MAP duplicate keys
- **Change:** Removed 7 duplicate keys in CATEGORY_MAP that were silently overwriting correct mappings: `bridge`, `derivatives`, `perpetuals`, `cross-chain`, `rollup`, `prediction-market`, `liquid-staking`. Also cleaned up obsolete early entries that mapped bridge→defi_dex and prediction-market→defi_dex (later rounds had added correct mappings but originals remained as dead overrides).
- **Files:** scoring/category-weights.js
- **Tests:** 177/177 pass

### Round 332 — Fix meme_token large-cap blending comment accuracy
- **Change:** Corrected comment on large-cap meme blending formula. Comment said "$1B = 10% L1" but formula actually produces 0% at $1B, reaching 30% at $10B (log10 scale). Formula is correct — comment was misleading.
- **Files:** scoring/category-weights.js
- **Tests:** 177/177 pass

### Round 333 — Mercenary TVL breaker minimum mcap raised to $2M
- **Change:** Raised minimum mcap threshold for "mercenary TVL" circuit breaker from $500K to $2M. Below $2M, a 15x TVL/MCap ratio is noise not signal — micro-cap tokens have fragile mcap pricing and the imbalance is expected rather than alarming.
- **Files:** scoring/circuit-breakers.js
- **Tests:** 177/177 pass

### Round 334 — Hack mentions circuit breaker: exclude passive targets
- **Change:** Added exclusion for meme, stablecoin, and wrapped tokens from the hack/exploit mentions circuit breaker. These token types frequently appear in ecosystem-level security news without being directly exploited, causing false caps.
- **Files:** scoring/circuit-breakers.js
- **Tests:** 177/177 pass

### Round 335 — Onchain confidence N/A vs error distinction
- **Change:** When onchain collector has no error but also no data fields (non-DeFi token), onchainConf is now 50 (N/A, not applicable) instead of 0 (collection failure). This prevents overall_confidence from being artificially depressed for non-DeFi tokens that simply don't have TVL/fees.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 336 — Dev confidence N/A vs error distinction
- **Change:** Same fix as Round 335 for dev/GitHub confidence. Closed-source tokens with no GitHub data get devConf=50 (N/A) instead of 0. Prevents unnecessary overall_confidence deflation for legitimate closed-source projects.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 337 — Tiered completeness circuit breaker caps
- **Change:** Added a stricter cap (5.0) for extremely low data completeness (<20%). Previously only one threshold (<40% → 6.0). New tiers: <20% → cap 5.0 (speculative), <40% → cap 6.0 (insufficient).
- **Files:** scoring/circuit-breakers.js
- **Tests:** 177/177 pass

### Round 338 — Red flag no_github: null check instead of falsy
- **Change:** Fixed `no_github` red flag detection to use `== null` instead of falsy check. Previously `github.stars = 0` (inactive but real repo) would trigger the flag incorrectly. A repo with 0 stars/commits is verifiable data, not missing data.
- **Files:** services/red-flags.js
- **Tests:** 177/177 pass

### Round 339 — Red flag no_onchain_data: null check instead of falsy
- **Change:** Same fix for `no_onchain_data` — uses `== null` instead of falsy. TVL=0 is valid data for a new protocol with no locked capital. The old falsy check was incorrectly flagging new DeFi protocols as having no onchain data.
- **Files:** services/red-flags.js
- **Tests:** 177/177 pass

### Round 340 — zero_social_mentions: require search evidence
- **Change:** `zero_social_mentions` now only fires if there's evidence the social search actually ran (sentiment_score, key_narratives, or bot_filtered_count present). Prevents false positives when the social collector never ran or returned an empty object.
- **Files:** services/red-flags.js
- **Tests:** 177/177 pass

### Round 341 — Deflationary token tokenomics bonus
- **Change:** Added a small tokenomics score bonus for deflationary tokens (inflation_rate < 0, i.e. net token burns). Bonus capped at +0.5 to avoid over-rewarding aggressive burn programs. Maps: -10% inflation = +0.5 max bonus.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 342 — FDV unknown but low circulating supply: infer dilution risk
- **Change:** When FDV is unavailable but circulating supply is <50%, apply a mild -0.5 penalty to distribution score. Captures likely dilution risk even when FDV data is missing from the collector.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 343 — Volatility scoring: normalize across available timeframes
- **Change:** Fixed volatility calculation to not assume 0 for missing timeframes. Previously if only 24h data was available, 40% of the volatility signal was artificially zeroed out. Now normalizes to available timeframes only (24h-only = use 24h; 7d-only = use 7d; both = 0.6/0.4 weighted).
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 344 — CATEGORY_MAP: 16 new category slug mappings
- **Change:** Added 16 missing category slugs: staking, staking-pool, eth-staking, sol-staking, governance, governance-token, dao, launchpad, ido-platform, asset-management, portfolio-management, aggregator, dex-aggregator, swap-aggregator, and mapped infrastructure → infra_tooling (previously layer_1).
- **Files:** scoring/category-weights.js
- **Tests:** 177/177 pass

### Round 345 — Fix holder field name mismatch (top10_holder_concentration_pct)
- **Change:** Critical bug fix: the holders collector outputs `top10_holder_concentration_pct` but circuit-breakers, red-flags, and scoring used `top10_concentration` and `concentration_pct`. Added the actual collector field name to all fallback chains so whale concentration data is actually used in scoring.
- **Files:** scoring/circuit-breakers.js, services/red-flags.js, synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 346 — FDV/MCap circuit breaker: $1M minimum mcap
- **Change:** Added $1M minimum mcap to the FDV/MCap > 10x circuit breaker. Micro-cap tokens with high FDV ratios are already captured by the low_market_cap red flag and don't need a separate score cap.
- **Files:** scoring/circuit-breakers.js
- **Tests:** 177/177 pass

### Round 347 — suspicious_volume_spike: $500K minimum absolute threshold
- **Change:** Added $500K absolute minimum to `suspicious_volume_spike` red flag. Small tokens with very low 7d average can produce technically-valid but meaningless spike ratios (e.g. $100 avg → $600 24h = 6x spike).
- **Files:** services/red-flags.js
- **Tests:** 177/177 pass

### Round 348 — Zero CEX listings penalty for established tokens
- **Change:** Added mild -0.3 penalty in scoreMarketStrength when `exchange_count` is explicitly 0 (not missing) for tokens older than 6 months. Being known to have zero CEX listings after 6 months signals isolation/accessibility risk.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 349 — Holder confidence: stricter fallback (meaningful fields only)
- **Change:** Tightened holder confidence fallback: only gives 30% confidence if there are actual non-null, non-error data fields. An object with only `{ error: null }` no longer gets 30% partial credit.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 350 — Fix computePTVLAdjustment dead label statement
- **Change:** Fixed a dead JavaScript label statement `label: 'deep_value';` that was a syntactic no-op in the PTVL calculation. The variable assignment `label = 'deep_value'` on the next line was the actual working code. Cleaned up to single clear assignment.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 351 — computePTVLAdjustment: NaN guard
- **Change:** Added `Number.isFinite()` guards for mcap and tvl inputs to `computePTVLAdjustment`. Prevents NaN adjustment values when inputs are NaN (e.g. from safeNumber of undefined chain).
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 352 — scoreRisk: genesis_date validation
- **Change:** Added date validation before computing token age in `scoreRisk`. Guards against invalid dates, pre-2008 dates (pre-crypto era), and future dates — all of which would produce NaN or astronomically high age_months values.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 353 — scoreMarketStrength: genesis_date validation
- **Change:** Same date validation as Round 352 applied to `scoreMarketStrength` genesis_date age computation. Also guards against future dates causing negative age_months.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 354 — CATEGORY_MAP: infrastructure → infra_tooling (was layer_1)
- **Change:** Changed `infrastructure` slug mapping from `layer_1` to `infra_tooling`. The `infra_tooling` category has `development: 0.32` vs `layer_1: development: 0.22` — more accurate for B2B infrastructure protocols that are dev-activity driven rather than ecosystem adoption driven.
- **Files:** scoring/category-weights.js
- **Tests:** 177/177 pass

### Round 355 — scoreOnchainHealth: remove duplicate feesCheck variable
- **Change:** Removed duplicate `feesCheck` variable that was identically computed as `fees`. The zero-fees TVL penalty now reuses the `fees` variable computed earlier in the function.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 356 — declining_tvl: null-safe check and granular severity
- **Change:** Fixed `declining_tvl` red flag to only fire when TVL change data actually exists (field != null). Added catastrophic tier: >70% decline = 'critical' (was 'warning' for >50%). Clearer messaging for catastrophic TVL collapses.
- **Files:** services/red-flags.js
- **Tests:** 177/177 pass

### Round 357 — socialCredibility circuit breaker: fix safeN(null, null) = 0 bug
- **Change:** Critical bug fix: `safeN(null, null)` returns 0 (not null) because Number.isFinite(0) is true. The social credibility circuit breaker was checking `!== null` but could receive 0 (meaning "field not present") and activate falsely. Fixed to use direct field existence check before calling safeN.
- **Files:** scoring/circuit-breakers.js
- **Tests:** 177/177 pass

### Round 358 — Fix false null guards for optional numeric fields (priceMomentumScore, realizedVol90d)
- **Change:** Fixed two instances of `safeNumber(field ?? null)` followed by `!== null` check — this pattern is broken because safeNumber(null) = 0 ≠ null so the guard is always true. Replaced with `if (field != null)` guard pattern. Applied to `price_momentum_score` and `realized_vol_90d`.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 359 — Fix false null guard for chainTvlDominance
- **Change:** Same fix as Round 358 for `chain_tvl_dominance_pct`. The `chainTvlDominance !== null` check was always true when using `safeNumber(... ?? null)`. Now uses `onchain.chain_tvl_dominance_pct != null` guard.
- **Files:** synthesis/scoring.js
- **Tests:** 177/177 pass

### Round 360 — CATEGORY_MAP: 20 new category slug mappings
- **Change:** Added 20 new category mappings covering: web3-gaming, p2e, gamefi, infrastructure-middleware, middleware, cross-chain-messaging, interoperability, identity/DID protocols, insurance variants, credit protocols, synthetic assets, structured products, options/perpetual/margin trading, on-chain ETFs, tokenized equity/commodity. Improves categorization accuracy for newer DeFi verticals.
- **Files:** scoring/category-weights.js
- **Tests:** 177/177 pass

## AutoResearch Prompt Engineering Batch — 30 Rounds (2026-03-27 02:30 UTC)

**Focus:** Prompt Engineering & LLM Output Quality — buildOpusPrompt improvements, bull/bear case specificity, anti-repetition, buildDataSummary context, quick report anti-hallucination, validateReport guardrails.

### Round 361 — FACT_REGISTRY: 8 new fields for LLM grounding
- **Change:** Added net_buy_pressure_pct, volume_to_liquidity_ratio, price_momentum_score, community_score, revenue_per_active_user, commit_frequency, days_since_last_commit, bus_factor_score to buildFactRegistry().
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 362 — buildDataSummary: holders section — accept both field name variants + holder_count
- **Change:** Holders section now accepts both top10_holder_concentration_pct and top10_concentration_pct. Added holder_count with context label when available.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 363 — buildDataSummary: contract section enrichment
- **Change:** Contract section now shows is_proxy, audited, audit_firms, honeypot detection, buy/sell tax with ⚠️ for high values.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 364 — buildOpusPrompt: category analysis for AI infra, gaming, bridge, derivatives
- **Change:** Added 4 new category-specific analysis registers: ai_infrastructure, web3_gaming, cross_chain_bridge, derivatives — each with sector-specific benchmarks and focus areas.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 365 — validateReport: verdict-score consistency check + scores parameter
- **Change:** validateReport() now accepts optional scores parameter. Added verdict-score divergence warning when implied score differs >2.5pts from algorithmic score.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 366 — buildDataSummary: 52-week price context section
- **Change:** Added new 52-WEEK PRICE CONTEXT section showing tier label (near 52w high/low/mid), pct_from_52w_high, pct_from_52w_low when data available.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 367 — buildDataSummary: GitHub velocity tier + bus factor qualitative labels
- **Change:** GitHub section now shows github_velocity_tier with emoji labels and contributor_bus_factor qualitative description. Also added critical_issue_ratio in Round 382.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 368 — buildOpusPrompt: strict paragraph scope definitions for analysis_text
- **Change:** Replaced generic "cover different ground" with explicit 4-paragraph scope template: P1=verdict+top metrics, P2=fundamentals deep-dive (different numbers), P3=market+sentiment, P4=outlook with concrete thresholds.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 369 — validateReport: improved commit count hallucination detection
- **Change:** Multiple commit pattern regexes (90 days, quarter, 3 months variants). Breaks on first match. More robust than single pattern.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 370 — Quick report: 11-rule anti-hallucination block
- **Change:** Rewrote quick report anti-hallucination from 10 to 11 explicit rules. Added bull_case/bear_case number requirement (rule 8), source tags scope (rule 10), x_sentiment BANNED rule (rule 5 with "BANNED" keyword).
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 371 — buildDataSummary: Narrative momentum context section
- **Change:** Added NARRATIVE MOMENTUM section showing alignment, active narratives (up to 5), dominance score with label, and momentum quality trend.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 372 — buildOpusPrompt: narrative context in user message
- **Change:** Added NARRATIVE_CONTEXT block to Opus user message when narrative_momentum data is available — alignment, narratives, dominance score, trend, detail.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 373 — buildOpusPrompt: moat instruction with 4 evidence-backed types + forbidden list
- **Change:** Moat instruction now specifies 4 evidence-backed moat types (SCALE/DEV-TECH/LIQUIDITY-NETWORK/TOKENOMICS) each requiring specific RAW_DATA fields. Explicit FORBIDDEN list: "first mover advantage", "strong community" (without number), "network effects" (without data), "innovative", "unique", "robust ecosystem".
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 374 — Quick report: LIQUIDITY CONTEXT block inline
- **Change:** Added inline LIQUIDITY CONTEXT block showing DEX liquidity with position sizing guidance, volume velocity %, buy/sell pressure label.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 375 — thesis-generator.js: sector comparison in bull/bear cases
- **Change:** generateThesis() now computes sectorBullNote and sectorBearNote from sector_comparison.price_to_tvl and percentile data. Appended to bull/bear case strings when sector data is available.
- **Files:** services/thesis-generator.js
- **Tests:** 177/177 pass

### Round 376 — buildDataSummary: realized volatility 90d + days_since_ath in market section
- **Change:** Added realized_vol_90d (annualized %) with volatility label, and days_since_ath with recency context in market section.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 377 — buildOpusPrompt: VOLATILITY_CONTEXT block in user message
- **Change:** When volatility regime is not 'calm', a VOLATILITY_CONTEXT block is injected with regime, caution multiplier, 24h swing, realized vol, and explicit position sizing reduction instruction.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 378 — buildDataSummary: MCap/Vol coverage ratio in market section
- **Change:** Added MCap/Vol coverage ratio (how many days of volume = market cap) with liquidity label (very liquid/liquid/moderate/illiquid).
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 379 — validateReport: moat generic phrase detection
- **Change:** Added post-processing check that flags forbidden moat phrases (first mover advantage, strong community without number, network effects without data, robust ecosystem, innovative/unique). Logged as warnings.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 380 — buildOpusPrompt: DATA_COMPLETENESS context block
- **Change:** Added DATA_COMPLETENESS block to user message showing % completeness, available vs failed collectors, and explicit HOLD cap instruction when completeness < 40%.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 381 — buildOpusPrompt: risks output format with severity labels + forbidden generics
- **Change:** Risks instruction now requires "[SEVERITY] [Risk Type]: [number from data]. [price impact]" format. Severity labels: CRITICAL/HIGH/MEDIUM/LOW. Explicit forbidden patterns: "Regulatory uncertainty" without context, "Smart contract risk" without audit data.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 382 — buildDataSummary: critical_issue_ratio in GitHub section
- **Change:** Added issues-per-contributor ratio with context labels (overwhelming backlog/high load/moderate/healthy capacity) in GitHub section of data summary.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 383 — validateReport: analysis_text paragraph count validation
- **Change:** Added paragraph structure check to validateReport. Warns if analysis_text has <2 paragraphs (single block) or >6 paragraphs (fragmented). Expected: 3-4 focused paragraphs.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 384 — buildOpusPrompt: CROSS_DIMENSIONAL_SIGNALS block in user message
- **Change:** Added CROSS_DIMENSIONAL_SIGNALS block injecting algorithmically detected convergences (bullish) and divergences (conflicting) from cross_dimensional analysis data.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 385 — buildOpusPrompt: TEMPORAL_SIGNALS block (score momentum history)
- **Change:** Added TEMPORAL_SIGNALS block from temporal_delta when history exists — shows overall narrative, recent score momentum signals (SCORE_MOMENTUM with direction arrow).
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 386 — Quick report: inline DEV CONTEXT block
- **Change:** Added inline DEV CONTEXT block for quick report showing commits/wk, velocity tier, contributors, days since last commit, dev quality index.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 387 — buildDataSummary: active_addresses_7d + daily_active_users in onchain section
- **Change:** Onchain section now shows active_addresses_7d (with user base size label) and daily_active_users when available — product engagement signal.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 388 — buildOpusPrompt: catalysts output format with data-backed patterns
- **Change:** Catalysts instruction now requires "[Catalyst Type]: [observation from data] → [expected impact]" format with 3 concrete examples. Emphasizes 1-2 data-backed > 4 generic catalysts.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 389 — validateReport: duplicate metric detection in key_findings
- **Change:** Added check for duplicate metric types in key_findings (TVL, market cap, volume, commits, etc.). Warns when same metric appears in multiple findings.
- **Files:** synthesis/llm.js
- **Tests:** 177/177 pass

### Round 390 — Engine version bump to r63-2026-03-27
- **Change:** Bumped engine_version to r63-2026-03-27 marking the Prompt Engineering batch completion.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass


### Round 391 — renderScoreLine: consistent 1 decimal score
- **Change:** Score always rendered as `X.X/10` (1 decimal). Confidence label shown when available.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 392 — fmtPlain(): non-dollar number formatter
- **Change:** Added `fmtPlain(value, decimals)` for formatting counts, ratios, commits without $ prefix. Supports B/M/K suffixes.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 393 — text report: headline + project_summary in header
- **Change:** Header line now shows `Verdict | Alpha Index | Conviction` in one line. Headline and project_summary appear as separate lines below. Data quality summary collapsed to single line.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 394 — text report: FDV/mcap ratio + circulating supply % + ATH distance
- **Change:** Added FDV/MCap ratio, circulating supply %, and ATH distance in key metrics text block.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 395 — text report: thesis one_liner + time horizons + conviction score
- **Change:** Investment Thesis section now shows one_liner, conviction_score, and time_horizon_short/medium fields.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 396 — HTML: project_summary + headline panel
- **Change:** Added summary panel between header and key metrics — shows headline in bold + project_summary text.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 397 — HTML: 7d price change + FDV/mcap ratio metric cards
- **Change:** Added 7d change card (with directional color) and FDV/MCap ratio card (with risk color coding: red >5x, yellow >2x) to key metrics section.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 398 — HTML: alpha signals section
- **Change:** Added alpha signals section after key findings — shows up to 6 signals with strength color coding (green=strong, yellow=moderate, grey=weak).
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 399 — HTML: narrative strength section
- **Change:** Added narrative strength section with strength label + score badge before elevator pitch.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 400 — HTML: trade setup as flex card layout
- **Change:** Trade setup section replaced inline text with flex cards (Entry Zone, Stop Loss, TP1, TP2, R/R, Quality) — more scannable.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 401 — HTML: footer with engine version + data quality badge
- **Change:** Added footer bar showing engine version, quality tier (color-coded), coverage %, completeness %.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 402 — JSON: tl_dr field
- **Change:** Added `tl_dr` to main JSON output — one-sentence summary: `ProjectName: VERDICT (X.X/10) — elevator pitch`.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 403 — JSON: risk_profile object
- **Change:** Added `risk_profile` to main JSON — consolidates risk_level, critical_flags, circuit_breakers_active, volatility_regime, supply_unlock_risk, fdv_overhang, wash_trading_risk.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 404 — formatAgentJSON: tl_dr + alpha_index_label
- **Change:** Added `tl_dr` and `alpha_index_label` (exceptional/strong/moderate/weak/poor) to agent JSON format.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 405 — formatAgentJSON: risk_profile block
- **Change:** Added `risk_profile` consolidated block to agent JSON — mirrors main JSON structure.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 406 — /alpha/export: tl_dr + risk_profile + narrative_strength
- **Change:** Export endpoint now includes `tl_dr`, `risk_profile` (with volatility/supply/fdv_overhang), and `narrative_strength` fields.
- **Files:** routes/alpha-history.js
- **Tests:** 177/177 pass

### Round 407 — MCP alpha_research: richer preamble
- **Change:** MCP alpha_research preamble now shows TL;DR, alpha_index_label, risk profile summary, and data quality tier.
- **Files:** routes/mcp.js
- **Tests:** 177/177 pass

### Round 408 — MCP get_oracle_signals: severity grouping + emoji
- **Change:** Oracle signals now grouped by severity (critical→high→medium→low) with emoji indicators and count per group.
- **Files:** routes/mcp.js
- **Tests:** 177/177 pass

### Round 409 — MCP x_sentiment: emoji score bar + structured sections
- **Change:** X sentiment response now shows sentiment emoji, ASCII score bar `[████░░░░░░]`, and structured Narratives/KOL/Trending sections.
- **Files:** routes/mcp.js
- **Tests:** 177/177 pass

### Round 410 — formatPlainText: alpha index + risk level in header
- **Change:** Plain text header now shows `⚡alphaIndex/100 🛡️riskLevel` alongside verdict and score.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 411 — formatMarkdown: alpha index + risk level + tl_dr in header
- **Change:** Markdown header shows score, alpha index, risk level in one line. Elevator pitch rendered as blockquote.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 412 — formatMarkdown: alpha signals section
- **Change:** Added Alpha Signals section to markdown with `[STRENGTH]` labels.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 413 — JSON: opportunity_snapshot field
- **Change:** Added `opportunity_snapshot` to main JSON — {verdict, score, alpha_index, risk_level, action_bias: enter_large|enter_moderate|watch|stay_out|exit_if_held}.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 414 — formatAgentJSON: opportunity_snapshot + alpha_signals_top3
- **Change:** Agent JSON now includes `opportunity_snapshot` (5-field decision helper) and `alpha_signals_top3` (strong/moderate signals only).
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 415 — /alpha/export: opportunity_snapshot + alpha_signals_top3
- **Change:** Export now includes opportunity_snapshot and alpha_signals_top3 for fast agent consumption.
- **Files:** routes/alpha-history.js
- **Tests:** 177/177 pass

### Round 416 — MCP trading_signals: structured header + R:R emoji labels
- **Change:** Signals response now shows bullish/bearish bias header, per-signal R:R emoji (🔥≥3, ✅≥2, ⚠️≥1, ❌<1).
- **Files:** routes/mcp.js
- **Tests:** 177/177 pass

### Round 417 — HTML: supply unlock + volatility regime badges in risk summary
- **Change:** Risk summary now shows volatility regime and supply unlock badges as colored pills.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 418 — HTML: data quality coverage/completeness/tier in header
- **Change:** Replaced plain "Collector failures" text with structured coverage %, completeness %, and quality tier (color-coded) in report header.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 419 — text report: onchain context section
- **Change:** Added ⛓️ Onchain Context section showing TVL 7d change, fee revenue 30d, active addresses 7d, P/TVL ratio.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 420 — HTML: scores as visual bar chart
- **Change:** Score section rebuilt as grid with per-dimension progress bars (color-coded by score level) replacing plain list items.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 421 — formatReportMulti: new 'agent' format
- **Change:** Added `format=agent` to formatReportMulti — compact structured text for AI consumption. Includes TL;DR, opportunity snapshot, risk profile, top signals, all key sections.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 422 — /alpha/export: ?format= param routing
- **Change:** `/alpha/export` now supports `?format=agent|md|text|json|html` via formatReportMulti. Falls back to default JSON if format is unrecognized.
- **Files:** routes/alpha-history.js
- **Tests:** 177/177 pass

### Round 423 — JSON: score_snapshot flat map
- **Change:** Added `score_snapshot` to main JSON — flat `{dim: score}` map for quick parsing (all 8 dims, 1 decimal).
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 424 — formatAgentJSON: score_snapshot
- **Change:** Added `score_snapshot` to agent JSON with same structure.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 425 — text report: richer X sentiment block
- **Change:** X sentiment section now shows structured sentiment score + KOL sentiment + engagement level + narratives before LLM summary.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 426 — HTML: X sentiment with sentiment badge + KOL + narratives
- **Change:** HTML X sentiment section now shows sentiment badge (green/red/yellow), KOL sentiment pill, engagement level, key narratives inline.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 427 — JSON: filter empty validation_warnings
- **Change:** validation_warnings array now filters null/empty strings for cleaner output.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 428 — formatAgentJSON: data_quality block
- **Change:** Added `data_quality` block to agent JSON — {total_collectors, ok_collectors, failed_collectors, coverage_pct, completeness_pct, quality_tier}.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 429 — HTML: thesis section one_liner pull quote + conviction score
- **Change:** Thesis section now shows one_liner as styled italic pull quote and conviction_score above the bull/bear/neutral grid.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 430 — Engine version bump to r64-2026-03-27
- **Change:** Bumped engine_version to r64-2026-03-27 marking the Report Templates & Output Quality batch completion.
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 431 — SCORE_MOMENTUM: velocity_tier label (fast/normal/slow)
- **Change:** Added `velocity_tier` (fast/normal/slow) to SCORE_MOMENTUM data_json and title based on pts/h speed.
- **Files:** oracle/signal-detector.js
- **Tests:** 177/177 pass

### Round 432 — SCORE_MOMENTUM: score_zone + zone crossing detection
- **Change:** Added `score_zone` (strong_buy/watch/neutral/avoid) + `prev_score_zone` + `crossed_zone` flag. Title now shows zone transition when boundary is crossed.
- **Files:** oracle/signal-detector.js
- **Tests:** 177/177 pass

### Round 433 — CATEGORY_LEADER_SHIFT: category_momentum (strengthening/weakening/stable)
- **Change:** Compute avg score of top3 current vs old. If delta > 0.3 = strengthening, < -0.3 = weakening. Added to data_json and title.
- **Files:** oracle/signal-detector.js
- **Tests:** 177/177 pass

### Round 434 — DIVERGENCE: divergence_magnitude composite scoring
- **Change:** Added `divergence_magnitude` = score × |price_change| / 10, with `magnitude_label` (extreme/strong/moderate). Used to rank which divergences are most actionable.
- **Files:** oracle/signal-detector.js
- **Tests:** 177/177 pass

### Round 435 — REGIME_SHIFT: fully implemented (BTC price + score distribution analysis)
- **Change:** Replaced placeholder with real detection: BTC median price comparison 7d, portfolio avg score delta, stddev dispersion change. Detects bear_entering, bull_entering, rotation, convergence.
- **Files:** oracle/signal-detector.js
- **Tests:** 177/177 pass

### Round 436 — BREAKER_ALERT: breaker_risk_score (1-10 composite)
- **Change:** Added `breaker_risk_score` to BREAKER_ALERT data_json and title — composite from severity (4pts) + count (3pts) + duration (3pts). Enables alert prioritization.
- **Files:** oracle/signal-detector.js
- **Tests:** 177/177 pass

### Round 437 — DIVERGENCE: volume_confirmation flag
- **Change:** Positive divergence with high volume = accumulation confirmed; negative divergence with high volume = distribution confirmed. Added to data_json and detail.
- **Files:** oracle/signal-detector.js
- **Tests:** 177/177 pass

### Round 438 — SCORE_MOMENTUM: relative change severity upgrade
- **Change:** If relative score change >30% (e.g. 4.0→5.2 = 30% relative), upgrade severity medium→high regardless of absolute delta.
- **Files:** oracle/signal-detector.js
- **Tests:** 177/177 pass

### Round 439-440 — New alpha signals: multi_timeframe_momentum + score_momentum_alignment
- **Change:** `multi_timeframe_momentum`: all 3 timeframes (1h/24h/7d) bullish or bearish. `score_momentum_alignment`: oracle score >= 7.0 + strong price momentum tier.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 441 — getSignalStrengthScore: theme clustering bonus
- **Change:** 3+ signals in same theme (onchain/social/technical) adds +8 pts bonus for correlated conviction.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 442 — Trade setup: Fibonacci support anchoring for entry zone
- **Change:** When price is between ATL and ATH, find nearest Fibonacci support below price (within 15%) and anchor entry low to it.
- **Files:** services/trade-setup.js
- **Tests:** 177/177 pass

### Round 443 — Risk/reward: signal_count_multiplier
- **Change:** 3+ strong alpha signals boost EV by 3% per strong signal beyond 2nd (max +15%). Zero signals penalizes EV 10%.
- **Files:** services/risk-reward.js
- **Tests:** 177/177 pass

### Round 444 — New alpha signal: on_chain_fee_velocity
- **Change:** Weekly fee rate vs monthly fee rate — if weekly annualized > monthly annualized × 1.3, protocol extraction is accelerating.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 445 — New alpha signals: healthy_holder_distribution + holder_distribution_improving
- **Change:** Gini coefficient < 0.7 = healthy distribution; improving trend = reducing concentration over time.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 446 — Trend reversal: momentum tier regime flip + DEX intraday burst
- **Change:** When price_momentum_tier shows uptrend but 30d is negative → regime flip. DEX m5+h1+h24 all positive after 30d downtrend = potential reversal catalyst.
- **Files:** services/trend-reversal.js
- **Tests:** 177/177 pass

### Round 447 — Trade setup: Fibonacci stop loss refinement
- **Change:** After base volatility stop, find highest Fibonacci support below current stop. If within 5% of original stop, use it as more precise stop (with 2% buffer).
- **Files:** services/trade-setup.js
- **Tests:** 177/177 pass

### Round 448 — Risk/reward: trend_reversal_adjustment
- **Change:** Bullish reversal high-confidence → +12% EV. Accumulation → +6%. Bearish reversal high-confidence → -20% EV + position size downgrade. Distribution → -10%.
- **Files:** services/risk-reward.js
- **Tests:** 177/177 pass

### Round 449 — New alpha signal: protocol_upgrade_catalyst
- **Change:** Detects v2/upgrade/migration narratives in social mentions. Protocol upgrades historically drive 30-150%+ price appreciation.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 450 — Trade setup: entry_timing_score (0-100) + entry_timing_label
- **Change:** Composite entry timing quality score: score quality (30pts) + RR ratio (25pts) + volatility fit (25pts) + proximity to support (20pts). Labels: excellent/good/fair/poor.
- **Files:** services/trade-setup.js
- **Tests:** 177/177 pass

### Round 451 — New alpha signal: low_stablecoin_systemic_risk
- **Change:** When 80%+ of protocol TVL in blue-chip stablecoins (USDC/USDT/DAI) = low systemic risk.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 452 — New alpha signal: high_developer_activity composite
- **Change:** 6-indicator composite (stars growth, forks, PRs, commits, commit trend, open issues). 4/6 = moderate, 5/6 = strong.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 453 — momentum.js: weighted momentum_score (0-100)
- **Change:** Added `momentum_score` (weighted: market 25, onchain 20, social 15, dev 15, dex 15, tokenomics 10) and `momentum_score_label` (strongly_bullish/bullish/neutral/bearish/strongly_bearish).
- **Files:** services/momentum.js
- **Tests:** 177/177 pass

### Round 454 — Risk/reward: momentum_score EV adjustment
- **Change:** momentum_score ≥70 boosts EV up to +15%; ≤30 penalizes EV proportionally.
- **Files:** services/risk-reward.js
- **Tests:** 177/177 pass

### Round 455 — New alpha signal: deep_liquidity_pool
- **Change:** DEX liquidity ≥5% of market cap with $1M+ = institutional market maker presence. ≥10% = strong.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 456 — DIVERGENCE: persistence check across snapshots
- **Change:** Check prior 3 snapshots for same divergence condition. 2+ persistent = upgrade severity medium→high, add persistence note to detail.
- **Files:** oracle/signal-detector.js
- **Tests:** 177/177 pass

### Round 457 — New alpha signal: high_token_velocity
- **Change:** Daily volume / (circulating supply × price) > 10% = active on-chain utility. Shows token is actively traded, not just held.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 458 — Risk/reward: score_confidence_adjustment
- **Change:** Confidence <40% → -20% EV penalty. Confidence ≥85% → +5% EV boost. Separate from probability adjustments.
- **Files:** services/risk-reward.js
- **Tests:** 177/177 pass

### Round 459 — SCORE_MOMENTUM: delta_acceleration (Δ²)
- **Change:** Calculate second derivative of score changes. If last delta is larger than prior delta = accelerating momentum. Added to title, detail, and data_json.
- **Files:** oracle/signal-detector.js
- **Tests:** 177/177 pass

### Round 460 — New alpha signal: active_addresses_growth
- **Change:** Weekly active address rate vs monthly average. If weekly rate 30% above monthly trend = organic adoption acceleration.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 461 — CATEGORY_LEADER_SHIFT: top_mover_detail
- **Change:** Added `entered_details` and `exited_details` arrays to data_json — shows who entered/exited with their score before/after.
- **Files:** oracle/signal-detector.js
- **Tests:** 177/177 pass

### Round 462 — New alpha signal: net_buying_pressure_composite
- **Change:** Requires 3/4 buy pressure indicators (DEX ratio, CEX volume change, 24h price, pressure_signal). Multi-source confirmation reduces false positives.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 463 — Trade setup: partial_take_profit_strategy
- **Change:** Based on RR ratio: excellent RR (≥3) = 25/35/40 split; good (≥2) = 33/34/33; moderate (≥1.5) = 40/40/20; weak = 60/30/10. Helps agents size exits.
- **Files:** services/trade-setup.js
- **Tests:** 177/177 pass

### Round 464 — New alpha signal: supply_unlock_risk + mid_unlock_near_ath_caution
- **Change:** Upcoming unlock ≥5% in 30 days = selling pressure warning. Mid-unlock phase near ATH = caution weak signal.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 465 — Risk/reward: supply_unlock_ev_adjustment
- **Change:** Large unlock (≥10%, ≤14d) = -25% EV + position size downgrade. Moderate unlock (≥5%, ≤30d) = -12% EV.
- **Files:** services/risk-reward.js
- **Tests:** 177/177 pass

### Round 466 — Trend reversal: sparkline V-reversal detection
- **Change:** Split 7d sparkline in half. If second half avg > first half avg × 1.1 = V-reversal pattern. +2 bullish points.
- **Files:** services/trend-reversal.js
- **Tests:** 177/177 pass

### Round 467 — New alpha signals: sector_outperforming_btc + outperforming_sector
- **Change:** When sector performance > BTC by 5%+ = sector rotation signal. When project > sector by 5%+ = idiosyncratic strength.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 468 — momentum.js: dex_market_divergence field
- **Change:** Added `dex_market_divergence` = when DEX momentum diverges from market momentum. Values: dex_leading_reversal / market_overextended / aligned / mixed.
- **Files:** services/momentum.js
- **Tests:** 177/177 pass

### Round 469 — New alpha signal: social_leads_price
- **Change:** High social sentiment (>0.6) + KOL bullish + price barely moved (<3% 24h, <10% 7d) = social leading price signal. Early entry window.
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass

### Round 470 — Engine version bump to r470-2026-03-27
- **Change:** Bumped engine_version to r470-2026-03-27 marking Oracle Signal Detection & Alpha Signals batch completion (R431-470).
- **Files:** synthesis/templates.js
- **Tests:** 177/177 pass

### Round 471 — Deduplicate safeN utility in analysis/ files
- **Change:** Removed inline `safeN` / `safeNum` definitions in `analysis/temporal.js`, `analysis/conviction.js`, and `analysis/risk-matrix.js`. All now import canonical `safeNum` or `safeNumber` from `utils/math.js`. Reduces code duplication and ensures consistent null-safety semantics across the codebase.
- **Files:** `analysis/temporal.js` (safeNum), `analysis/conviction.js` (safeNumber), `analysis/risk-matrix.js` (safeNumber)
- **Tests:** 177/177 pass
- **Result:** kept — cleaner code, single source of truth for numeric sanitization

### Round 472 — Add JSDoc to clamp utility
- **Change:** Added complete JSDoc annotations (`@param`, `@returns`) to `clamp()` in `utils/math.js`. All exported math functions now have full documentation.
- **Files:** `utils/math.js`
- **Tests:** 177/177 pass
- **Result:** kept — better IntelliSense and dev UX

### Round 473 — Deduplicate safeN in circuit-breakers.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** scoring/circuit-breakers.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 474 — Deduplicate safeN in category-weights.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** scoring/category-weights.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 475 — Deduplicate safeN in alpha-signals.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/alpha-signals.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 476 — Deduplicate safeN in change-detector.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/change-detector.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 477 — Deduplicate safeN in competitor-detection.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/competitor-detection.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 478 — Deduplicate safeN in elevator-pitch.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/elevator-pitch.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 479 — Deduplicate safeN in momentum.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/momentum.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 480 — Deduplicate safeN in narrative-momentum.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/narrative-momentum.js
- **Tests:** 177/177 pass
- **Result:** kept
### Round 481 — Deduplicate safeN in red-flags.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/red-flags.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 482 — Deduplicate safeN in report-quality.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/report-quality.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 483 — Deduplicate safeN in risk-reward.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/risk-reward.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 484 — Deduplicate safeN in score-velocity.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/score-velocity.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 485 — Deduplicate safeN in supply-unlock-detector.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/supply-unlock-detector.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 486 — Deduplicate safeN in thesis-generator.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/thesis-generator.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 487 — Deduplicate safeN in trade-setup.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/trade-setup.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 488 — Deduplicate safeN in trend-reversal.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/trend-reversal.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 489 — Deduplicate safeN in volatility-guard.js
- **Change:** Removed inline safeN, import from utils/math.js
- **Files:** services/volatility-guard.js
- **Tests:** 177/177 pass
- **Result:** kept

### Round 490 — Skip complex file synthesis/scoring.js
- **Change:** N/A (file too complex for automated refactor)
- **Result:** skipped

