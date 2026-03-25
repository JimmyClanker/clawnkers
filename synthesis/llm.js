const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const DEFAULT_TIMEOUT_MS = 60000;
const FAST_MODEL = 'grok-4-1-fast-non-reasoning';
const REASONING_MODEL = 'grok-4.20-multi-agent-0309';
const FALLBACK_VERDICTS = [
  { min: 8.5, verdict: 'STRONG BUY' },
  { min: 7, verdict: 'BUY' },
  { min: 5.5, verdict: 'HOLD' },
  { min: 3.5, verdict: 'AVOID' },
  { min: 0, verdict: 'STRONG AVOID' },
];

function withTimeout(timeoutMs, callback) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return callback(controller.signal).finally(() => clearTimeout(timeout));
}

function pickVerdict(score) {
  return FALLBACK_VERDICTS.find((item) => score >= item.min)?.verdict || 'HOLD';
}

function normalizeList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;

  const seen = new Set();
  const items = [];

  for (const item of value) {
    const normalized = String(item).trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
  }

  return items.length ? items : fallback;
}

function normalizeVerdict(value, fallbackScore = 0) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

  return FALLBACK_VERDICTS.some((item) => item.verdict === normalized)
    ? normalized
    : pickVerdict(fallbackScore);
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks = [];
  for (const item of payload?.output || []) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (typeof content?.text === 'string' && content.text.trim()) {
        chunks.push(content.text.trim());
      }
    }
  }

  return chunks.join('\n').trim();
}

function buildFactRegistry(rawData = {}) {
  const facts = [];
  const push = (key, value) => {
    if (value == null) return;
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    facts.push({ key, value });
  };

  push('market.current_price', rawData?.market?.current_price ?? rawData?.market?.price);
  push('market.market_cap', rawData?.market?.market_cap);
  push('market.total_volume', rawData?.market?.total_volume);
  push('market.ath_distance_pct', rawData?.market?.ath_distance_pct);
  push('onchain.tvl', rawData?.onchain?.tvl);
  push('onchain.tvl_change_7d', rawData?.onchain?.tvl_change_7d);
  push('onchain.tvl_change_30d', rawData?.onchain?.tvl_change_30d);
  push('onchain.fees_7d', rawData?.onchain?.fees_7d);
  push('onchain.revenue_7d', rawData?.onchain?.revenue_7d);
  push('social.filtered_mentions', rawData?.social?.filtered_mentions ?? rawData?.social?.mentions);
  push('social.sentiment_score', rawData?.social?.sentiment_score);
  push('github.commits_90d', rawData?.github?.commits_90d);
  push('github.contributors', rawData?.github?.contributors);
  push('tokenomics.pct_circulating', rawData?.tokenomics?.pct_circulating);
  push('dex.dex_liquidity_usd', rawData?.dex?.dex_liquidity_usd);
  push('dex.dex_price_usd', rawData?.dex?.dex_price_usd);
  push('dex.buy_sell_ratio', rawData?.dex?.buy_sell_ratio);
  push('dex.dex_pair_count', rawData?.dex?.dex_pair_count);
  push('market.price_change_24h', rawData?.market?.price_change_percentage_24h);
  push('market.price_change_7d', rawData?.market?.price_change_percentage_7d_in_currency);
  push('market.price_change_30d', rawData?.market?.price_change_percentage_30d_in_currency);
  push('market.fdv', rawData?.market?.fully_diluted_valuation ?? rawData?.market?.fdv);
  push('market.market_cap_rank', rawData?.market?.market_cap_rank);
  push('onchain.treasury_balance', rawData?.onchain?.treasury_balance);
  push('onchain.revenue_to_fees_ratio', rawData?.onchain?.revenue_to_fees_ratio);
  push('reddit.post_count', rawData?.reddit?.post_count);
  push('reddit.sentiment', rawData?.reddit?.sentiment);
  push('holders.top10_concentration_pct', rawData?.holders?.top10_concentration_pct);
  push('ecosystem.chain_count', rawData?.ecosystem?.chain_count);
  push('ecosystem.primary_chain', rawData?.ecosystem?.primary_chain);
  push('contract.verified', rawData?.contract?.verified);

  return facts;
}

/**
 * Formats a number into human-readable form (e.g. $1.2M, $68.2B).
 */
function formatNumber(value) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/**
 * Builds a compact, human-readable summary of rawData (replaces JSON dump).
 * Exported so tests can import it.
 */
export function buildDataSummary(rawData = {}) {
  const lines = ['=== VERIFIED DATA (from collectors) ===\n'];
  const gaps = [];

  // Helper to add a data point
  const add = (label, value, formatter = (v) => v) => {
    if (value != null && value !== '') {
      return `- ${label}: ${formatter(value)}`;
    }
    return null;
  };

  // MARKET [CoinGecko]
  const market = rawData.market || {};
  if (!market.error && rawData.market) {
    const marketLines = [];
    marketLines.push(add('Price', market.current_price ?? market.price, formatNumber));
    marketLines.push(add('Market Cap', market.market_cap, (v) => `${formatNumber(v)} (rank #${market.market_cap_rank ?? 'n/a'})`));
    marketLines.push(add('24h Volume', market.total_volume, formatNumber));
    marketLines.push(add('24h Change', market.price_change_percentage_24h, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`));
    marketLines.push(add('7d Change', market.price_change_percentage_7d_in_currency, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`));
    marketLines.push(add('30d Change', market.price_change_percentage_30d_in_currency, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`));
    marketLines.push(add('ATH Distance', market.ath_distance_pct, (v) => `${v.toFixed(1)}%`));
    marketLines.push(add('FDV', market.fully_diluted_valuation ?? market.fdv, formatNumber));

    const validMarket = marketLines.filter(Boolean);
    if (validMarket.length) {
      lines.push('MARKET [CoinGecko]:');
      lines.push(...validMarket);
      const missing = [];
      if (market.price_change_percentage_30d_in_currency == null) missing.push('30d change');
      if (missing.length) lines.push(`(missing: ${missing.join(', ')})`);
      lines.push('');
    } else {
      gaps.push('market (no data)');
    }
  } else {
    gaps.push('market (no data)');
  }

  // ONCHAIN [DeFiLlama]
  const onchain = rawData.onchain || {};
  if (!onchain.error && rawData.onchain) {
    const onchainLines = [];
    onchainLines.push(add('TVL', onchain.tvl, formatNumber));
    onchainLines.push(add('TVL 7d Change', onchain.tvl_change_7d, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`));
    onchainLines.push(add('TVL 30d Change', onchain.tvl_change_30d, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`));
    onchainLines.push(add('Fees 7d', onchain.fees_7d, formatNumber));
    onchainLines.push(add('Revenue 7d', onchain.revenue_7d, formatNumber));
    onchainLines.push(add('Treasury', onchain.treasury_balance, formatNumber));

    const validOnchain = onchainLines.filter(Boolean);
    if (validOnchain.length) {
      lines.push('ONCHAIN [DeFiLlama]:');
      lines.push(...validOnchain);
      const missing = [];
      if (onchain.treasury_balance == null) missing.push('treasury');
      if (missing.length) lines.push(`(missing: ${missing.join(', ')})`);
      lines.push('');
    } else {
      gaps.push('onchain (no data)');
    }
  } else {
    gaps.push('onchain (no data)');
  }

  // SOCIAL [Exa/X]
  const social = rawData.social || {};
  if (!social.error && rawData.social) {
    const socialLines = [];
    const mentions = social.filtered_mentions ?? social.mentions;
    if (mentions != null) {
      socialLines.push(`- Mentions: ${mentions}${social.filtered_mentions != null && social.mentions != null ? ` (filtered: ${social.filtered_mentions})` : ''}`);
    }
    socialLines.push(add('Sentiment Score', social.sentiment_score, (v) => {
      const label = v > 0.2 ? 'bullish-leaning' : v < -0.2 ? 'bearish-leaning' : 'neutral';
      return `${v.toFixed(1)} (${label})`;
    }));
    socialLines.push(add('Bot Ratio', social.bot_ratio, (v) => `${(v * 100).toFixed(0)}%`));

    const validSocial = socialLines.filter(Boolean);
    if (validSocial.length) {
      lines.push('SOCIAL [Exa/X]:');
      lines.push(...validSocial);
      lines.push('');
    } else {
      gaps.push('social (no data)');
    }
  } else {
    gaps.push('social (no data)');
  }

  // GITHUB [GitHub API]
  const github = rawData.github || {};
  if (!github.error && rawData.github) {
    const githubLines = [];
    githubLines.push(add('Commits 90d', github.commits_90d));
    githubLines.push(add('Contributors', github.contributors));
    githubLines.push(add('Stars', github.stars));
    githubLines.push(add('Commit Trend', github.commit_trend));

    const validGithub = githubLines.filter(Boolean);
    if (validGithub.length) {
      lines.push('GITHUB [GitHub API]:');
      lines.push(...validGithub);
      const missing = [];
      if (github.languages == null) missing.push('languages');
      if (missing.length) lines.push(`(missing: ${missing.join(', ')})`);
      lines.push('');
    } else {
      gaps.push('github (no data)');
    }
  } else {
    gaps.push('github (no data)');
  }

  // DEX [DexScreener]
  const dex = rawData.dex || {};
  if (!dex.error && rawData.dex) {
    const dexLines = [];
    dexLines.push(add('DEX Price', dex.dex_price_usd, formatNumber));
    dexLines.push(add('Liquidity', dex.dex_liquidity_usd, formatNumber));
    dexLines.push(add('Pair Count', dex.dex_pair_count));
    dexLines.push(add('Buy/Sell Ratio', dex.buy_sell_ratio, (v) => v.toFixed(1)));

    const validDex = dexLines.filter(Boolean);
    if (validDex.length) {
      lines.push('DEX [DexScreener]:');
      lines.push(...validDex);
      lines.push('');
    } else {
      gaps.push('dex (no data)');
    }
  } else {
    gaps.push('dex (no data)');
  }

  // REDDIT
  const reddit = rawData.reddit || {};
  if (!reddit.error && (reddit.post_count != null || reddit.sentiment != null)) {
    const redditLines = [];
    redditLines.push(add('Post Count', reddit.post_count));
    redditLines.push(add('Sentiment', reddit.sentiment));
    const validReddit = redditLines.filter(Boolean);
    if (validReddit.length) {
      lines.push('REDDIT:');
      lines.push(...validReddit);
      lines.push('');
    }
  } else {
    gaps.push('reddit (no data)');
  }

  // HOLDERS
  const holders = rawData.holders || {};
  if (!holders.error && holders.top10_concentration_pct != null) {
    lines.push('HOLDERS:');
    lines.push(add('Top 10 Concentration', holders.top10_concentration_pct, (v) => `${v.toFixed(1)}%`));
    lines.push('');
  } else {
    gaps.push('holders (no data)');
  }

  // TOKENOMICS
  const tokenomics = rawData.tokenomics || {};
  if (!tokenomics.error && tokenomics.pct_circulating != null) {
    lines.push('TOKENOMICS:');
    lines.push(add('% Circulating', tokenomics.pct_circulating, (v) => `${v.toFixed(1)}%`));
    lines.push('');
  }

  // CONTRACT
  const contract = rawData.contract || {};
  if (!contract.error && contract.verified != null) {
    lines.push('CONTRACT:');
    lines.push(add('Verified', contract.verified, (v) => v ? 'Yes' : 'No'));
    lines.push('');
  } else {
    gaps.push('contract (no data)');
  }

  // Data gaps summary
  if (gaps.length) {
    lines.push(`DATA GAPS: ${gaps.join(', ')}`);
  }

  return lines.join('\n');
}

function inferProjectCategory(rawData = {}) {
  const candidates = [
    rawData?.onchain?.category,
    rawData?.sector_comparison?.category,
    rawData?.sector_context?.category,
    rawData?.ecosystem?.category,
    rawData?.market?.category,
  ];

  for (const value of candidates) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }

  return null;
}

function summarizeChains(rawData = {}) {
  const candidates = [
    rawData?.dex?.dex_chains,
    rawData?.ecosystem?.chains,
    rawData?.onchain?.chains,
  ];

  for (const list of candidates) {
    if (Array.isArray(list) && list.length) {
      return list
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 3);
    }
  }

  const primary = String(rawData?.ecosystem?.primary_chain || '').trim();
  return primary ? [primary] : [];
}

function buildPrompt(projectName, rawData, scores) {
  const overallScore = scores?.overall?.score ?? 0;
  const factRegistry = buildFactRegistry(rawData);

  return [
    '## ROLE',
    'You are a senior crypto alpha analyst. Your job: produce actionable, evidence-based reports for sophisticated investors. No fluff, no generic disclaimers.',

    '## CRITICAL: ANTI-HALLUCINATION RULES',
    'These rules are ABSOLUTE and override everything else:',
    '1. EVERY factual claim MUST be backed by either: (a) a specific field from RAW_DATA below, (b) a specific X Search result you found, or (c) a specific Web Search result with URL.',
    '2. If X Search or Web Search returns NO relevant results for a topic, write "No recent data found" — NEVER invent details, names, dates, or events.',
    '3. NEVER invent: funding round amounts, partnership announcements, exchange listings, protocol upgrades, TVL numbers, price targets, or any specific facts not in the provided data.',
    '4. NEVER invent KOL names, Twitter accounts, or attribute opinions to specific people unless you found them via X Search.',
    '5. If you cannot verify a catalyst or risk with data, prefix it with "[Unverified]" or omit it entirely.',
    '6. For competitor_comparison: ONLY compare metrics that exist in RAW_DATA or that you verified via search. Do not invent TVL, fees, or market cap numbers for competitors.',
    '7. For x_sentiment_summary: If X Search returned nothing meaningful, write "Limited X/Twitter data available for this project." Do NOT fabricate community sentiment.',
    '8. Numbers in your analysis MUST match RAW_DATA but FORMAT THEM FOR HUMANS: $292.6M not 292636115, -2.48% not -2.484401525322113%. Round to 2 decimal places max. Always include $ for USD values.',
    '9. When in doubt, say LESS. A shorter, accurate report is infinitely better than a longer, hallucinated one.',
    '10. NEVER expose internal field names (tvl_change_7d, dex_liquidity_usd, ecosystem.chain_count). Use human labels: "7-day TVL change", "DEX liquidity", "supported chains".',

    '## INSTRUCTIONS',
    '1. Use the attached RAW_DATA and SCORES as your PRIMARY and AUTHORITATIVE data source. These are verified from CoinGecko, DeFiLlama, GitHub, Messari, DexScreener, Reddit, and Etherscan.',
    '2. Use X Search to find RECENT discussion (last 7-30 days). Report ONLY what you actually find. If no results, say so.',
    '3. Use Web Search to check for RECENT news. Report ONLY what you actually find with source URLs. If no results, say so.',
    '4. Synthesize into a coherent thesis, but ONLY use verified information.',
    '5. Clearly separate FACTS (from data) from OPINIONS (your analysis). Your opinions are welcome but must be labeled as such.',
    '6. INTERNAL tracking: for each claim, mentally verify which data source backs it. But do NOT put [source: ...] tags in analysis_text, moat, risks, catalysts, or x_sentiment_summary. Those tags make the output unreadable for humans.',
    '7. Put source references ONLY in the facts_verified array (e.g., "TVL: $414.8M [source: RAW_DATA.onchain.tvl]").',

    '## SCORING CALIBRATION',
    `The algorithmic score is ${overallScore}/10. Use this as a starting point but adjust based on qualitative factors:`,
    '- STRONG BUY (8.5-10): Clear edge — strong fundamentals + positive narrative + upcoming catalyst. High conviction entry.',
    '- BUY (7-8.4): Solid fundamentals, constructive sentiment, risk/reward favorable. Worth accumulating.',
    '- HOLD (5.5-6.9): Mixed signals. Worth watching but no urgent entry. Wait for better setup.',
    '- AVOID (3.5-5.4): Weak fundamentals or negative developments. Better opportunities elsewhere.',
    '- STRONG AVOID (0-3.4): Clear red flags — failing fundamentals, negative catalysts, or active risk events.',

    '## OUTPUT FORMAT',
    'Return ONLY valid JSON. Required fields:',
    '- verdict: "STRONG BUY" | "BUY" | "HOLD" | "AVOID" | "STRONG AVOID"',
    '- project_summary: 1-2 sentences explaining what the project IS, in plain English for an investor seeing it for the first time. Derive from RAW_DATA and verified search results. No hype, no source tags.',
    '- project_category: the project\'s primary category (examples: "DeFi Lending", "Layer 1", "DEX", "NFT Marketplace", "AI Infrastructure", "Meme Token"). Use the most specific category you can support from RAW_DATA and verified search results.',
    '- analysis_text: 3-4 clean paragraphs for HUMAN READERS. Para 1: summary thesis with key metrics. Para 2: on-chain/fundamental evidence. Para 3: market/sentiment context. Para 4: near-term outlook. FORMAT ALL NUMBERS READABLY: use $414.8M not 414828652, use -2.48% not -2.484401525322113%, use $292.6M not 292636115. NO source tags, NO field names like "tvl_change_7d" — write human-readable labels.',
    '- moat: competitive advantage in 1-2 sentences. Must be based on RAW_DATA or verified search results.',
    '- risks: array of 3-5 risk strings. Format: "Risk type: specific detail." Only include risks you can substantiate with data. NO source tags.',
    '- catalysts: array of 2-4 upcoming catalysts. ONLY include catalysts you found via Web/X Search with evidence. Prefix unverified ones with "[Unverified]". It is OK to have fewer catalysts if data is limited.',
    '- competitor_comparison: Compare ONLY with metrics you have data for. If no competitor data available, write "Insufficient data for competitor comparison."',
    '- x_sentiment_summary: Summarize ONLY what X Search actually returned. If nothing relevant found, write "Limited X/Twitter data available."',
    '- key_findings: array of 3-5 key findings. Each MUST reference a specific data point from RAW_DATA or a search result.',
    '- liquidity_assessment: Based on RAW_DATA volume, market cap, and DEX liquidity. Do not invent slippage estimates.',
    '- data_gaps: array of strings listing what data was missing or could not be verified. This helps the reader assess report reliability.',
    '- facts_verified: array of 4-8 strings. ONLY hard facts, each with a [source: ...] tag.',
    '- opinions: array of 2-5 strings. Analytical interpretations; if not directly proven, prefix with [Opinion].',
    '- section_confidence: object with numbers (0-100): { fundamentals, market_sentiment, outlook, overall } based on evidence quality.',

    ...(rawData?.sector_comparison
      ? [
          '## SECTOR CONTEXT',
          'The project has been benchmarked against its sector peers. Use this to calibrate the verdict:',
          JSON.stringify(rawData.sector_comparison, null, 2),
        ]
      : []),

    ...(rawData?.percentiles
      ? [
          '## PERCENTILE CONTEXT',
          'These are the percentile rankings of this project across all historically scanned projects (0 = bottom, 100 = top):',
          JSON.stringify(rawData.percentiles, null, 2),
        ]
      : []),

    ...(Array.isArray(rawData?.red_flags) && rawData.red_flags.length
      ? [
          '## RED FLAGS',
          'The following red flags were algorithmically detected. Weigh these heavily in your risk assessment:',
          rawData.red_flags.map((f) => `- [${f.severity?.toUpperCase() || 'WARNING'}] ${f.flag}: ${f.detail}`).join('\n'),
        ]
      : []),

    ...(Array.isArray(rawData?.alpha_signals) && rawData.alpha_signals.length
      ? [
          '## ALPHA SIGNALS',
          'The following positive alpha signals were algorithmically detected. Factor these into your thesis:',
          rawData.alpha_signals.map((s) => `- [${s.strength?.toUpperCase() || 'MODERATE'}] ${s.signal}: ${s.detail}`).join('\n'),
        ]
      : []),

    // Round 16: DEX-specific price context
    ...(rawData?.dex && !rawData.dex.error
      ? [
          '## DEX MARKET DATA',
          `Top DEX: ${rawData.dex.top_dex_name || 'n/a'}`,
          `DEX Price: $${rawData.dex.dex_price_usd || 'n/a'}`,
          `DEX Liquidity: $${rawData.dex.dex_liquidity_usd ? Number(rawData.dex.dex_liquidity_usd).toLocaleString() : 'n/a'}`,
          `DEX 1h change: ${rawData.dex.dex_price_change_h1 != null ? rawData.dex.dex_price_change_h1 + '%' : 'n/a'}`,
          `DEX 24h change: ${rawData.dex.dex_price_change_h24 != null ? rawData.dex.dex_price_change_h24 + '%' : 'n/a'}`,
          `DEX pair count: ${rawData.dex.dex_pair_count || 'n/a'} pairs across ${(rawData.dex.dex_chains || []).join(', ') || 'n/a'}`,
          // Round 13: buy/sell pressure
          ...(rawData.dex.pressure_signal ? [
            `DEX Buy/Sell pressure: ${rawData.dex.pressure_signal} (ratio: ${rawData.dex.buy_sell_ratio ?? 'n/a'}, buys: ${rawData.dex.buys_24h ?? 'n/a'}, sells: ${rawData.dex.sells_24h ?? 'n/a'})`,
          ] : []),
        ]
      : []),

    // Round 13: price range position context
    ...(rawData?.market?.price_range_position != null
      ? [
          '## PRICE RANGE CONTEXT',
          `Price range position: ${(rawData.market.price_range_position * 100).toFixed(1)}% of ATL→ATH range (0% = ATL, 100% = ATH)`,
          `ATH distance: ${rawData.market.ath_distance_pct != null ? rawData.market.ath_distance_pct.toFixed(1) + '%' : 'n/a'}`,
          `ATL distance: ${rawData.market.atl_distance_pct != null ? '+' + rawData.market.atl_distance_pct.toFixed(1) + '%' : 'n/a'}`,
          ...(rawData?.onchain?.tvl_stickiness ? [`TVL stickiness: ${rawData.onchain.tvl_stickiness}`] : []),
        ]
      : []),

    // Round 25: volume efficiency and P/TVL vs sector
    ...(rawData?.sector_comparison?.volume_efficiency
      ? [
          '## VOLUME & VALUATION EFFICIENCY VS SECTOR',
          `Volume/TVL ratio: ${JSON.stringify(rawData.sector_comparison.volume_efficiency)}`,
          ...(rawData.sector_comparison.price_to_tvl ? [`P/TVL ratio: ${JSON.stringify(rawData.sector_comparison.price_to_tvl)}`] : []),
        ]
      : []),

    // Round 48: price alerts context
    ...(Array.isArray(rawData?.price_alerts) && rawData.price_alerts.length > 0
      ? [
          '## PRICE ALERTS',
          'The following price action events have been detected automatically:',
          rawData.price_alerts.map((a) => `- [${a.severity.toUpperCase()}] ${a.type}: ${a.message}`).join('\n'),
        ]
      : []),

    // Round 28 (AutoResearch batch): narrative momentum context
    ...(rawData?.narrative_momentum?.active_narratives?.length > 0
      ? [
          `## NARRATIVE MOMENTUM (${rawData.narrative_momentum.narrative_alignment.toUpperCase()})`,
          rawData.narrative_momentum.detail,
          `Active macro narratives: ${rawData.narrative_momentum.active_narratives.map((n) => n.replace(/_/g, ' ')).join(', ')}.`,
        ]
      : []),

    // Round 18 (AutoResearch batch): trend reversal signal
    ...(rawData?.trend_reversal && rawData.trend_reversal.pattern !== 'none'
      ? [
          `## TREND REVERSAL SIGNAL: ${rawData.trend_reversal.pattern.toUpperCase()} (${rawData.trend_reversal.confidence} confidence)`,
          rawData.trend_reversal.detail,
          rawData.trend_reversal.signals.length > 0
            ? `Supporting signals: ${rawData.trend_reversal.signals.map((s) => `- ${s}`).join('; ')}`
            : '',
        ].filter(Boolean)
      : []),

    // Round 7 (AutoResearch batch): protocol maturity context
    ...(rawData?.onchain?.protocol_maturity
      ? [
          `## PROTOCOL MATURITY: ${rawData.onchain.protocol_maturity.toUpperCase()}`,
          rawData.onchain.protocol_maturity === 'tier1'
            ? 'This is a top-tier DeFi protocol by TVL and fees. Compare to blue-chip competitors (Uniswap, Aave, Compound-class).'
            : rawData.onchain.protocol_maturity === 'tier2'
              ? 'This is a mid-tier protocol with meaningful but not dominant traction. Compare to established but non-market-leader peers.'
              : rawData.onchain.protocol_maturity === 'tier3'
                ? 'This is a smaller protocol with limited traction. Emerging category or niche play — higher risk.'
                : 'Early-stage protocol. Insufficient TVL/fees data to establish tier. Treat as speculative.',
        ]
      : []),

    // Round 36: volatility regime context
    ...(rawData?.volatility && rawData.volatility.regime !== 'calm'
      ? [
          '## VOLATILITY REGIME',
          `Current volatility regime: ${rawData.volatility.regime.toUpperCase()} (caution multiplier: ${rawData.volatility.caution_multiplier})`,
          `24h price move: ${rawData.volatility.volatility_pct_24h != null ? rawData.volatility.volatility_pct_24h.toFixed(1) + '%' : 'n/a'}`,
          ...(rawData.volatility.notes.length ? rawData.volatility.notes.map((n) => `- ${n}`) : []),
          'NOTE: High volatility regimes require extra caution — reduce position sizing and tighten stops accordingly.',
        ]
      : []),

    '## FINAL REMINDER (READ THIS LAST)',
    'Before outputting your response, verify:',
    '1. Every number you cite matches FACT_REGISTRY or RAW_DATA exactly.',
    '2. Source tags go ONLY in facts_verified. Do NOT put [source: ...] in analysis_text, risks, catalysts, key_findings, moat, or any other user-facing field.',
    '3. If you wrote something you cannot trace to data or search results, DELETE IT.',
    '4. "I don\'t have data for this" is ALWAYS better than making something up.',
    '5. Shorter and accurate > longer and fabricated.',

    `PROJECT: ${projectName}`,
    `ALGORITHMIC_SCORES: ${JSON.stringify(scores, null, 2)}`,
    `FACT_REGISTRY: ${JSON.stringify(factRegistry, null, 2)}`,
    `RAW_DATA_SUMMARY:\n${buildDataSummary(rawData)}`,
  ].join('\n\n');
}

export function fallbackReport(projectName, rawData, scores, error = null) {
  const overallScore = Number(scores?.overall?.score || 0);
  const verdict = pickVerdict(overallScore);
  const risks = [];
  const catalysts = [];
  const keyFindings = [];
  const market = rawData?.market ?? {};
  const onchain = rawData?.onchain ?? {};
  const social = rawData?.social ?? {};
  const github = rawData?.github ?? {};

  const price = market.current_price ?? market.price;
  const change24h = market.price_change_pct_24h ?? market.price_change_percentage_24h ?? market.change_24h;
  const change7d = market.price_change_pct_7d ?? market.price_change_percentage_7d_in_currency;
  const mcap = market.market_cap;
  const vol24h = market.total_volume;
  const tvl = onchain.tvl;
  const tvlChange7d = onchain.tvl_change_7d;

  if ((rawData?.tokenomics?.pct_circulating || 0) < 50) {
    risks.push('Circulating supply is still limited: unlock/dilution risk remains.');
  }
  if ((rawData?.onchain?.tvl_change_30d || 0) < 0) {
    risks.push('TVL is contracting on a monthly basis.');
  }
  if ((social.sentiment || 'neutral') === 'bullish') {
    catalysts.push('Social sentiment is constructive and the narrative is active.');
  }
  if ((github.commits_90d || 0) > 30) {
    catalysts.push('Visible software development over the last 90 days.');
  }
  if ((change24h || 0) > 5) {
    catalysts.push('Strong short-term price momentum (+5% in 24h).');
  }
  if ((social.mentions || 0) > 100) {
    catalysts.push('High social mention volume detected.');
  }
  if ((tvlChange7d || 0) > 10) {
    catalysts.push('TVL growing rapidly on a weekly basis (+10%+).');
  }
  if ((vol24h || 0) > (mcap || Infinity) * 0.15) {
    catalysts.push('Volume/market-cap ratio elevated — active trading interest.');
  }
  if ((onchain.fees_7d || 0) > 0 && (onchain.revenue_7d || 0) > 0) {
    catalysts.push('Protocol is generating fees and revenue.');
  }
  if ((change24h || 0) < -10) {
    risks.push('Sharp price decline in 24h — possible negative catalyst.');
  }
  if ((social.sentiment || 'neutral') === 'bearish') {
    risks.push('Social sentiment is bearish.');
  }
  if ((vol24h || 0) < 50000) {
    risks.push('Extremely low trading volume — liquidity risk.');
  }
  if ((mcap || 0) > 0) {
    keyFindings.push(`Observed market cap: ${formatNumber(mcap)}.`);
  }
  if ((tvl || 0) > 0) {
    keyFindings.push(`Observed TVL: ${formatNumber(tvl)}.`);
  }
  if ((social.mentions || 0) > 0) {
    keyFindings.push(`Social mentions: ${social.mentions}.`);
  }
  if (github.commits_90d > 0) {
    keyFindings.push(`GitHub activity: ${github.commits_90d} commits in 90 days, ${github.contributors || 'n/a'} contributors.`);
  }
  if (rawData?.tokenomics?.pct_circulating) {
    keyFindings.push(`Circulating supply: ${rawData.tokenomics.pct_circulating.toFixed(1)}%.`);
  }

  const analysisText = (() => {
    const lines = [
      `${projectName} scores ${overallScore}/10 with a ${verdict} stance in fallback mode.`,
      price != null ? `Price is ${formatNumber(price)}${change24h != null ? `, ${Number(change24h) >= 0 ? '+' : ''}${Number(change24h).toFixed(1)}% over 24h` : ''}${change7d != null ? ` and ${Number(change7d) >= 0 ? '+' : ''}${Number(change7d).toFixed(1)}% over 7d` : ''}.` : null,
      mcap != null ? `Market cap sits at ${formatNumber(mcap)}${vol24h != null ? ` with ${formatNumber(vol24h)} in 24h volume` : ''}.` : null,
      tvl != null ? `TVL is ${formatNumber(tvl)}${tvlChange7d != null ? ` (${Number(tvlChange7d) >= 0 ? '+' : ''}${Number(tvlChange7d).toFixed(1)}% over 7d)` : ''}.` : null,
      `Dimension scores — Market ${scores?.market_strength?.score ?? 'n/a'}/10, Onchain ${scores?.onchain_health?.score ?? 'n/a'}/10, Social ${scores?.social_momentum?.score ?? 'n/a'}/10, Dev ${scores?.development?.score ?? 'n/a'}/10, Tokenomics ${scores?.tokenomics_health?.score ?? 'n/a'}/10, Distribution ${scores?.distribution?.score ?? 'n/a'}/10, Risk ${scores?.risk?.score ?? 'n/a'}/10.`,
      error ? `[Fallback: ${error}]` : null,
    ].filter(Boolean).join(' ');
    return lines;
  })();

  return {
    verdict,
    project_summary: null,
    project_category: null,
    headline: null,
    // Graceful failure: do not invent analysis when LLM failed
    analysis_text: null,
    moat:
      'Requires external qualitative validation; competitive advantage depends on network effects, liquidity, brand, and execution.',
    risks: risks.length ? risks : ['Data coverage is incomplete: further qualitative validation is required.'],
    catalysts: catalysts.length ? catalysts : ['No strong catalyst detected from on-chain data. Use full scan (with AI) for narrative and sentiment analysis.'],
    competitor_comparison:
      'Competitor comparison is unavailable in fallback mode; use category/chains/narrative to build a manual peer set.',
    x_sentiment_summary:
      'X sentiment is unavailable in local fallback mode; Grok X Search is required for qualitative validation.',
    key_findings: keyFindings.length
      ? keyFindings
      : ['Analysis is based only on local collectors and algorithmic scoring.'],
    // Round 5 (AutoResearch nightly): mark as fallback so report-quality.js can flag it
    is_fallback: true,
  };
}

/**
 * Clean report text fields: strip source tags, format raw numbers, humanize field names.
 */
function cleanReportText(text) {
  if (!text || typeof text !== 'string') return text;

  let cleaned = text;

  // 1. Remove [source: ...] tags
  cleaned = cleaned.replace(/\s*\[source:\s*[^\]]*\]/gi, '');

  // 2. Fix overly precise percentages FIRST — e.g., -2.484401525322113% → -2.48%
  // (must run before number formatting to avoid conflicts)
  cleaned = cleaned.replace(/([-+]?\d+\.\d{3,})%/g, (match, numStr) => {
    const num = parseFloat(numStr);
    if (isNaN(num)) return match;
    return `${num.toFixed(2)}%`;
  });

  // 3. Format raw large numbers (7+ digits) with separators; preserve explicit $ if present.
  // Avoid forcing currency on non-USD metrics (e.g., user counts, commits).
  cleaned = cleaned.replace(/\b(\$?)(\d{7,})(?![\d%])/g, (match, dollar, intPart) => {
    const formatted = Number(intPart).toLocaleString('en-US');
    return `${dollar}${formatted}`;
  });

  // 4. Replace snake_case field names with human labels
  const fieldMap = {
    'tvl_change_7d': '7-day TVL change',
    'tvl_change_30d': '30-day TVL change',
    'fees_7d': '7-day fees',
    'fees_30d': '30-day fees',
    'revenue_7d': '7-day revenue',
    'revenue_30d': '30-day revenue',
    'dex_liquidity_usd': 'DEX liquidity',
    'dex_pair_count': 'DEX pair count',
    'dex_price_usd': 'DEX price',
    'buy_sell_ratio': 'buy/sell ratio',
    'market_cap_rank': 'market cap rank',
    'price_change_24h': '24h price change',
    'price_change_7d': '7-day price change',
    'price_change_30d': '30-day price change',
    'current_price': 'current price',
    'market_cap': 'market cap',
    'total_volume': '24h volume',
    'fully_diluted_valuation': 'fully diluted valuation',
    'ecosystem.chain_count': 'supported chains',
    'ecosystem.primary_chain': 'primary chain',
    'github.contributors': 'contributors',
    'github.stars': 'stars',
    'github.commits_90d': 'commits (90d)',
    'top10_concentration_pct': 'top 10 holder concentration',
    'contract.verified': 'contract verified',
  };
  for (const [raw, human] of Object.entries(fieldMap)) {
    // Match with optional dot notation prefix (e.g., "onchain.tvl_change_7d" or just "tvl_change_7d")
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`(?:RAW_DATA[.])?(?:\\w+[.])?${escaped}`, 'g'), human);
  }

  // 5. Remove leftover "RAW_DATA." prefix references
  cleaned = cleaned.replace(/RAW_DATA\.\w+\.\w+/g, (match) => {
    // Extract last part and humanize
    const parts = match.split('.');
    return parts[parts.length - 1].replace(/_/g, ' ');
  });

  // 6. Remove "FACT_REGISTRY" references
  cleaned = cleaned.replace(/\bFACT_REGISTRY\b\s*/gi, '');

  // 7. Clean dangling provenance fragments after source-tag stripping.
  cleaned = cleaned
    .replace(/\bfrom\s*\.(?=[\s,.;:]|$)/gi, '')
    .replace(/\bfrom\s+(RAW_DATA|FACT_REGISTRY|DEX MARKET DATA|VERIFIED DATA)\b[:\s]*/gi, '')
    .replace(/\bfrom\s+(?=[,.;]|$)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1');

  return cleaned.trim();
}

function normalizeReport(payload, projectName, rawData, scores) {
  const overallScore = Number(scores?.overall?.score || 0);
  return {
    verdict: normalizeVerdict(payload?.verdict, overallScore),
    project_summary:
      cleanReportText(String(payload?.project_summary || '').trim()) || null,
    project_category:
      cleanReportText(String(payload?.project_category || '').trim()) || inferProjectCategory(rawData) || null,
    analysis_text:
      cleanReportText(String(payload?.analysis_text || '').trim()) || null,
    moat: cleanReportText(String(payload?.moat || '').trim()) || 'n/a',
    risks: normalizeList(payload?.risks, ['n/a']).map(r => cleanReportText(r)),
    catalysts: normalizeList(payload?.catalysts, ['n/a']).map(c => cleanReportText(c)),
    competitor_comparison: cleanReportText(String(payload?.competitor_comparison || '').trim()) || 'n/a',
    x_sentiment_summary: cleanReportText(String(payload?.x_sentiment_summary || '').trim()) || 'n/a',
    key_findings: normalizeList(payload?.key_findings, ['n/a']).map(f => cleanReportText(f)),
    data_gaps: normalizeList(payload?.data_gaps, []),
    facts_verified: normalizeList(payload?.facts_verified, []),
    opinions: normalizeList(payload?.opinions, []),
    section_confidence: {
      fundamentals: Number(payload?.section_confidence?.fundamentals ?? 50),
      market_sentiment: Number(payload?.section_confidence?.market_sentiment ?? 50),
      outlook: Number(payload?.section_confidence?.outlook ?? 50),
      overall: Number(payload?.section_confidence?.overall ?? 50),
    },
    // Round 7: liquidity assessment
    liquidity_assessment: String(payload?.liquidity_assessment || '').trim() || null,
    // Round 60: short headline (first sentence of analysis_text) for feed/preview use
    headline: (() => {
      const text = cleanReportText(String(payload?.analysis_text || '').trim());
      if (!text) return null;
      // End headline at a real sentence boundary without cutting decimal prices like $92.48.
      const firstSentence = text.match(/^.*?[.!?](?=\s+[A-Z\[]|$)/)?.[0];
      return firstSentence ? firstSentence.trim() : text.slice(0, 140) + (text.length > 140 ? '...' : '');
    })(),
  };
}

function hasSourceTag(text) {
  return /\[source:\s*[^\]]+\]/i.test(String(text || ''));
}

function clampPct(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Post-LLM validation: cross-check report claims against raw collector data.
 * Flags or sanitizes hallucinated content.
 */
export function validateReport(report, rawData) {
  const warnings = [];

  // 0. Normalize section confidence and enforce provenance fields
  report.section_confidence = {
    fundamentals: clampPct(report?.section_confidence?.fundamentals),
    market_sentiment: clampPct(report?.section_confidence?.market_sentiment),
    outlook: clampPct(report?.section_confidence?.outlook),
    overall: clampPct(report?.section_confidence?.overall),
  };

  if (!Array.isArray(report.facts_verified)) report.facts_verified = [];
  if (!Array.isArray(report.opinions)) report.opinions = [];

  // facts_verified is the ONLY field where [source: ...] tags are expected
  report.facts_verified = report.facts_verified
    .map((f) => String(f || '').trim())
    .filter(Boolean)
    .map((f) => (hasSourceTag(f) ? f : `${f} [source: missing]`));

  // key_findings and risks are user-facing — do NOT add source tags
  report.key_findings = (report.key_findings || []).map((k) => String(k || '').trim()).filter(Boolean);
  report.risks = (report.risks || []).map((r) => String(r || '').trim()).filter(Boolean);

  // 1. Check if x_sentiment_summary seems fabricated (mentions specific accounts but social data is empty)
  const socialData = rawData?.social;
  const hasSocialData = socialData && !socialData.error && (socialData.mentions > 0 || socialData.filtered_mentions > 0);
  if (!hasSocialData && report.x_sentiment_summary && report.x_sentiment_summary !== 'n/a') {
    // If no social collector data AND the summary looks substantive (not a "no data" message)
    const looksSubstantive = report.x_sentiment_summary.length > 80 &&
      !report.x_sentiment_summary.toLowerCase().includes('limited') &&
      !report.x_sentiment_summary.toLowerCase().includes('no data') &&
      !report.x_sentiment_summary.toLowerCase().includes('no recent');
    if (looksSubstantive || /@[a-z0-9_]{2,}/i.test(report.x_sentiment_summary)) {
      warnings.push('x_sentiment_summary may contain unverified claims (no social collector data available)');
      report.x_sentiment_summary = 'Limited X/Twitter data available for this project.';
    }
  }

  // 2. Validate market cap / price numbers in analysis_text against raw data
  // Match "$X market cap" or "market cap of $X" or "market cap: $X" — use only the FIRST dollar value directly adjacent to "market cap"
  const market = rawData?.market;
  if (market && report.analysis_text) {
    const reportedMcap = report.analysis_text.match(/\$([0-9,.]+)\s*(billion|million|B|M)\s+market\s*cap|market\s*cap\s+(?:of\s+|at\s+|:\s+|is\s+)?\$([0-9,.]+)\s*(billion|million|B|M)/i);
    if (reportedMcap && market.market_cap) {
      const rawVal = reportedMcap[1] ?? reportedMcap[3];
      const rawUnit = reportedMcap[2] ?? reportedMcap[4];
      const reportedValue = parseFloat(rawVal.replace(/,/g, ''));
      const unit = rawUnit.toLowerCase();
      const multiplier = (unit === 'billion' || unit === 'b') ? 1e9 : 1e6;
      const reportedActual = reportedValue * multiplier;
      const realMcap = market.market_cap;
      const deviation = Math.abs(reportedActual - realMcap) / realMcap;
      if (deviation > 0.25) {
        warnings.push(`Market cap in analysis ($${reportedValue}${unit}) deviates ${(deviation * 100).toFixed(0)}% from RAW_DATA ($${(realMcap / 1e9).toFixed(2)}B)`);
      }
    }
  }

  // 2b. Validate TVL numbers — match "TVL of $X" or "$X TVL" patterns only (not "TVL and $Y" which is a separate value)
  const onchain = rawData?.onchain;
  if (report.analysis_text) {
    const reportedTvl = report.analysis_text.match(/\$([0-9,.]+)\s*(billion|million|B|M)\s+TVL|TVL\s+(?:of|at|:|stands at|is|totals|reached|hit)?\s*\$([0-9,.]+)\s*(billion|million|B|M)/i);
    if (reportedTvl) {
      const rawVal = reportedTvl[1] ?? reportedTvl[3];
      const rawUnit = reportedTvl[2] ?? reportedTvl[4];
      const reportedValue = parseFloat(rawVal.replace(/,/g, ''));
      const unit = rawUnit.toLowerCase();
      const multiplier = (unit === 'billion' || unit === 'b') ? 1e9 : 1e6;
      const reportedActual = reportedValue * multiplier;

      if (!onchain?.tvl) {
        // LLM invented a TVL when raw data has none — hallucination!
        warnings.push(`TVL ($${reportedValue}${rawUnit}) mentioned but RAW_DATA has no TVL — removing hallucinated TVL`);
        report.analysis_text = report.analysis_text.replace(/[^.]*\$[0-9,.]+\s*(billion|million|B|M)\s+TVL[^.]*\./gi, '').replace(/[^.]*TVL\s+(?:of|at|:|stands at|is|totals|reached|hit)?\s*\$[0-9,.]+\s*(billion|million|B|M)[^.]*\./gi, '').trim();
      } else {
        const realTvl = onchain.tvl;
        const deviation = Math.abs(reportedActual - realTvl) / realTvl;
        if (deviation > 0.25) {
          warnings.push(`TVL in analysis ($${reportedValue}${unit}) deviates ${(deviation * 100).toFixed(0)}% from RAW_DATA ($${(realTvl / 1e9).toFixed(2)}B)`);
        }
      }
    }
  }

  // 2c. Validate circulating supply percentage — catch "0% circulating" when data says otherwise
  if (report.analysis_text) {
    const reportedCirc = report.analysis_text.match(/(\d+(?:\.\d+)?)\s*%\s*circulating/i);
    if (reportedCirc) {
      const reportedPct = parseFloat(reportedCirc[1]);
      const realPct = rawData?.tokenomics?.pct_circulating;
      if (realPct != null && realPct > 0 && Math.abs(reportedPct - realPct) > 15) {
        warnings.push(`Circulating supply in analysis (${reportedPct}%) deviates from RAW_DATA (${realPct.toFixed(1)}%) — correcting`);
        report.analysis_text = report.analysis_text.replace(
          new RegExp(`${reportedPct}\\s*%\\s*circulating`, 'gi'),
          `${realPct.toFixed(1)}% circulating`
        );
      } else if (reportedPct === 0 && (realPct == null || realPct === 0)) {
        // Both null/0 — flag but don't correct
        warnings.push('Circulating supply reported as 0% — data may be unavailable');
      }
    }
  }

  // 3. Check for common hallucination patterns
  const hallucinationPatterns = [
    /partnership with (google|microsoft|apple|amazon|meta)/i,
    /raised \$\d+.*(series [A-Z]|seed|funding)/i,  // funding claims need verification
    /listed on (binance|coinbase|kraken).*recently/i,  // listing claims
  ];

  if (report.analysis_text) {
    for (const pattern of hallucinationPatterns) {
      const match = report.analysis_text.match(pattern);
      if (match) {
        warnings.push(`Potential unverified claim detected: "${match[0]}"`);
      }
    }
  }

  // 4. If catalysts reference specific dates/events, flag if not from search
  if (Array.isArray(report.catalysts)) {
    report.catalysts = report.catalysts.map((c) => {
      const item = String(c || '').trim();
      if (!item) return item;
      let out = item;
      // Flag catalysts with very specific dates that might be hallucinated
      if (/Q[1-4]\s*20\d{2}|January|February|March|April|May|June|July|August|September|October|November|December\s+20\d{2}/i.test(out) && !out.includes('[Verified]')) {
        if (!out.startsWith('[')) out = '[Unverified timeline] ' + out;
      }
      // Catalysts are user-facing — do NOT add source tags
      return out;
    });
  }

  // 5. Ensure data_gaps field exists
  if (!report.data_gaps) {
    report.data_gaps = [];
    const collectors = ['market', 'onchain', 'social', 'github', 'tokenomics', 'dex', 'reddit', 'holders', 'ecosystem', 'contract'];
    for (const col of collectors) {
      if (!rawData?.[col] || rawData[col]?.error) {
        report.data_gaps.push(`${col}: data not available`);
      }
    }
  }

  // 6. User-facing text hygiene: remove source tags/snake_case/raw unformatted numbers.
  const userFacingFields = ['analysis_text', 'moat', 'competitor_comparison', 'x_sentiment_summary', 'liquidity_assessment'];
  for (const field of userFacingFields) {
    if (report[field]) report[field] = cleanReportText(report[field]);
    if (hasSourceTag(report[field])) warnings.push(`${field} contains source tag(s)`);
    if (/\b[a-z]+_[a-z0-9_]+\b/.test(String(report[field] || ''))) {
      warnings.push(`${field} contains snake_case field name(s)`);
    }
    if (/\b\d{7,}(?:\.\d+)?\b/.test(String(report[field] || ''))) {
      warnings.push(`${field} may contain unformatted large number(s)`);
    }
  }
  // 6b. Validate risks/key_findings for circulating supply hallucination
  const realPctCirc = rawData?.tokenomics?.pct_circulating;
  if (realPctCirc != null && realPctCirc > 0) {
    const fixCircInText = (text) => {
      const m = text.match(/(\d+(?:\.\d+)?)\s*%\s*circulating/i);
      if (m && Math.abs(parseFloat(m[1]) - realPctCirc) > 15) {
        warnings.push(`Risk/finding claims ${m[1]}% circulating but RAW_DATA says ${realPctCirc.toFixed(1)}% — correcting`);
        return text.replace(new RegExp(`${m[1]}\\s*%\\s*circulating`, 'gi'), `${realPctCirc.toFixed(1)}% circulating`);
      }
      return text;
    };
    report.risks = (report.risks || []).map((r) => fixCircInText(r));
    report.key_findings = (report.key_findings || []).map((k) => fixCircInText(k));
  }

  report.risks = (report.risks || []).map((r) => cleanReportText(r));
  report.catalysts = (report.catalysts || []).map((c) => cleanReportText(c));
  report.key_findings = (report.key_findings || []).map((k) => cleanReportText(k));

  // 7. Data sanity: DEX liquidity should not be implausibly above market cap.
  const mcap = Number(rawData?.market?.market_cap || 0);
  const dexLiquidity = Number(rawData?.dex?.dex_liquidity_usd || 0);
  if (mcap > 0 && dexLiquidity > mcap * 10) {
    warnings.push(`DEX liquidity ($${dexLiquidity.toLocaleString('en-US')}) exceeds 10x market cap ($${mcap.toLocaleString('en-US')}) — likely bad data`);
  }

  // Attach validation metadata
  report._validation = {
    warnings,
    validated_at: new Date().toISOString(),
    data_sources_available: Object.keys(rawData || {}).filter(k => rawData[k] && !rawData[k]?.error),
  };

  if (warnings.length > 0) {
    console.log(`[validate-report] ${warnings.length} warning(s): ${warnings.join('; ')}`);
  }

  return report;
}

async function requestXai({ apiKey, model, input, tools = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const response = await withTimeout(timeoutMs, (signal) =>
    fetch(XAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input,
        tools,
        text: { format: { type: 'json_object' } },
        max_output_tokens: 4000,
        temperature: 0,
      }),
      signal,
    })
  );

  if (!response.ok) {
    throw new Error(`xAI returned ${response.status}`);
  }

  return response.json();
}

export async function generateQuickReport(projectName, rawData, scores, { apiKey: explicitKey } = {}) {
  const apiKey = explicitKey || process.env.XAI_API_KEY;
  if (!apiKey) {
    return fallbackReport(projectName, rawData, scores, 'XAI_API_KEY missing');
  }

  const overallScore = scores?.overall?.score ?? 0;
  const prompt = [
    '## ROLE',
    'You are a senior crypto alpha analyst. Produce a concise but actionable quick-scan report. No tools available — rely ENTIRELY on attached data.',

    '## CRITICAL: ANTI-HALLUCINATION RULES',
    '1. You have NO tools — no web search, no X search. You can ONLY use RAW_DATA and SCORES provided below.',
    '2. NEVER invent facts, numbers, events, partnerships, funding rounds, or KOL opinions.',
    '3. EVERY claim must reference a specific data point from RAW_DATA.',
    '4. If data for a field is missing, write "Insufficient data" — do NOT fill in plausible-sounding information.',
    '5. For catalysts: only mention catalysts inferable from the data (e.g., "active development suggests upcoming releases"). Do NOT invent specific events or dates.',
    '6. For competitor_comparison: only compare if you have data. Otherwise write "No competitor data available in this scan."',
    '7. For x_sentiment_summary: only use data from social collector. If no social data, write "No social data available."',
    '8. A shorter, accurate report is ALWAYS better than a longer, hallucinated one.',
    '9. Do NOT put [source: ...] tags in analysis_text, moat, risks, or catalysts — those are for human readers. Put source references ONLY in facts_verified.',
    '10. FORMAT ALL NUMBERS for humans: $414.8M not 414828652, -2.48% not -2.484401525322113%. NEVER expose field names like tvl_change_7d — write "7-day TVL change" instead.',

    '## SCORING CALIBRATION',
    `Algorithmic score: ${overallScore}/10. Adjust verdict based on data quality and signal strength:`,
    '- STRONG BUY (8.5-10): Exceptional fundamentals + strong momentum + clear catalyst',
    '- BUY (7-8.4): Solid across most dimensions, favorable risk/reward',
    '- HOLD (5.5-6.9): Mixed or insufficient signals',
    '- AVOID (3.5-5.4): Weak fundamentals or concerning metrics',
    '- STRONG AVOID (0-3.4): Multiple red flags present',

    '## OUTPUT FORMAT',
    'Return ONLY valid JSON with these REQUIRED fields:',
    '- verdict: "STRONG BUY" | "BUY" | "HOLD" | "AVOID" | "STRONG AVOID"',
    '- project_summary: 1-2 sentences explaining what the project IS, using only RAW_DATA. No hype, no source tags.',
    '- project_category: OPTIONAL. The project\'s primary category if it is clear from RAW_DATA. If unclear, OMIT this field entirely.',
    '- analysis_text: 2-3 clean paragraphs for HUMAN READERS (thesis → evidence → outlook). Format numbers readably ($292.6M, -2.48%). No source tags, no field names.',
    '- moat: specific competitive advantage (1-2 sentences, avoid generics like "first mover")',
    '- risks: array of 3-5 risks, format: "Risk type: specific detail"',
    '- catalysts: array of 1-3 catalysts ONLY inferable from data (e.g., active dev = likely updates). Do NOT invent events. Prefix uncertain ones with "[Inferred]".',
    '- competitor_comparison: OPTIONAL. Only if sector_comparison data exists in RAW_DATA. If no sector data → OMIT this field entirely (do not write it).',
    '- x_sentiment_summary: OPTIONAL. Summarize ONLY social collector data from RAW_DATA. If social.mentions is 0 or social has error → OMIT this field entirely.',
    '- key_findings: array of 3-5 data-backed insights. Each MUST cite a specific number from RAW_DATA.',
    '- liquidity_assessment: based on volume and market_cap from RAW_DATA only.',
    '- data_gaps: array of strings listing which data sources were missing or had errors.',
    '- facts_verified: array of 3-6 strings with explicit [source: RAW_DATA.<field>] tags.',
    '- opinions: array of 1-3 strings prefixed with [Opinion].',
    '- section_confidence: object with numbers (0-100): { fundamentals, market_sentiment, outlook, overall }.',

    // Round 37: quick report also includes volatility regime
    ...(rawData?.volatility && rawData.volatility.regime !== 'calm'
      ? [
          `## VOLATILITY: ${rawData.volatility.regime.toUpperCase()} — 24h move ${rawData.volatility.volatility_pct_24h != null ? rawData.volatility.volatility_pct_24h.toFixed(1) + '%' : 'n/a'}. Adjust sizing and stops accordingly.`,
        ]
      : []),

    // Round 59: Concise market snapshot for quick orientation
    (() => {
      const m = rawData?.market ?? {};
      const o = rawData?.onchain ?? {};
      const price = m.current_price ?? m.price;
      const mcap = m.market_cap;
      const vol = m.total_volume;
      const tvl = o.tvl;
      const c24h = m.price_change_pct_24h;
      const c7d = m.price_change_pct_7d;
      const lines = ['## MARKET SNAPSHOT'];
      if (price != null) lines.push(`Price: $${Number(price).toLocaleString('en-US', { maximumSignificantDigits: 6 })}`);
      if (mcap != null) lines.push(`MCap: $${(Number(mcap) / 1e6).toFixed(1)}M`);
      if (vol != null) lines.push(`Vol24h: $${(Number(vol) / 1e6).toFixed(1)}M`);
      if (tvl != null) lines.push(`TVL: $${(Number(tvl) / 1e6).toFixed(1)}M`);
      if (c24h != null) lines.push(`24h: ${Number(c24h) >= 0 ? '+' : ''}${Number(c24h).toFixed(1)}%`);
      if (c7d != null) lines.push(`7d: ${Number(c7d) >= 0 ? '+' : ''}${Number(c7d).toFixed(1)}%`);
      return lines.length > 1 ? lines.join(' | ') : null;
    })(),

    `PROJECT: ${projectName}`,
    `ALGORITHMIC_SCORES: ${JSON.stringify(scores, null, 2)}`,
    `RAW_DATA_SUMMARY:\n${buildDataSummary(rawData)}`,
  ].filter(Boolean).join('\n\n');

  // Round 26: retry chain — fast model first, then longer timeout, then fallback
  const attempts = [
    { model: FAST_MODEL, timeoutMs: 25000 },
    { model: FAST_MODEL, timeoutMs: 35000 }, // same model, more time
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      const payload = await requestXai({ apiKey, model: attempt.model, input: prompt, tools: [], timeoutMs: attempt.timeoutMs });
      const text = extractOutputText(payload);
      if (!text || text.length < 50) {
        lastError = new Error('Empty response from xAI');
        continue;
      }
      console.log(`[quick-llm] Grok response length: ${text.length}`);
      const parsed = JSON.parse(text);
      const report = validateReport(normalizeReport(parsed, projectName, rawData, scores), rawData);
      console.log(`[quick-llm] x_sentiment: ${report.x_sentiment_summary?.substring(0, 60)}`);
      return report;
    } catch (err) {
      console.error(`[quick-llm] Attempt failed (${attempt.model}/${attempt.timeoutMs}ms): ${err.message}`);
      lastError = err;
      // Don't retry on parse errors — content is corrupt, not transient
      if (err instanceof SyntaxError) break;
    }
  }

  console.error(`[quick-llm] All attempts failed — using fallback`);
  return fallbackReport(
    projectName,
    rawData,
    scores,
    lastError?.name === 'AbortError' ? 'xAI quick timeout' : (lastError?.message ?? 'unknown error')
  );
}

export async function generateReport(projectName, rawData, scores, { apiKey: explicitKey } = {}) {
  const apiKey = explicitKey || process.env.XAI_API_KEY;
  if (!apiKey) {
    return fallbackReport(projectName, rawData, scores, 'XAI_API_KEY missing');
  }

  const prompt = buildPrompt(projectName, rawData, scores);

  try {
    const payload = await requestXai({
      apiKey,
      model: REASONING_MODEL,
      input: prompt,
      tools: [{ type: 'web_search' }, { type: 'x_search' }],
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    const text = extractOutputText(payload);
    const report = normalizeReport(JSON.parse(text), projectName, rawData, scores);
    return validateReport(report, rawData);
  } catch (error) {
    return fallbackReport(
      projectName,
      rawData,
      scores,
      error.name === 'AbortError' ? 'xAI timeout' : error.message
    );
  }
}
