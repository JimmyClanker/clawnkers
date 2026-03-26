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
