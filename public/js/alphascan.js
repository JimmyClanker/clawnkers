    // ── DOM Refs ─────────────────────────────────────────────────────
    const form        = document.getElementById('scan-form');
    const input       = document.getElementById('project-input');
    const quickLink   = document.getElementById('quick-link');
    const statusBox   = document.getElementById('status');
    const reportBox   = document.getElementById('report');
    const errorBox    = document.getElementById('error-box');
    const resultsSection = document.getElementById('results-section');
    const dexDropdown = document.getElementById('dex-dropdown');

    // Hero buttons removed (form is now in hero directly)

    // ── Score metadata ────────────────────────────────────────────────
    const SCORE_META = [
      ['market_strength',   'Market',       '#b5c7d3'],
      ['onchain_health',    'Onchain',      '#D4580A'],
      ['social_momentum',   'Social',       '#ffd3b6'],
      ['development',       'Dev',          '#c5b3e6'],
      ['tokenomics_health', 'Tokenomics',   '#ffdfba'],
      ['distribution',      'Distribution', '#a8e6cf'],
    ];

    // ── Helpers ───────────────────────────────────────────────────────
    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    }
    function verdictClass(verdict) {
      const v = String(verdict || '').toUpperCase();
      if (v.includes('BUY'))  return 'buy';
      if (v.includes('HOLD')) return 'hold';
      return 'avoid';
    }
    function formatCompactNumber(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return 'n/a';
      const abs = Math.abs(num), sign = num < 0 ? '-' : '';
      if (abs >= 1e12) return `${sign}$${(abs/1e12).toFixed(2)}t`;
      if (abs >= 1e9)  return `${sign}$${(abs/1e9).toFixed(2)}B`;
      if (abs >= 1e6)  return `${sign}$${(abs/1e6).toFixed(2)}M`;
      if (abs >= 1e3)  return `${sign}$${(abs/1e3).toFixed(2)}K`;
      if (abs > 0 && abs < 1) { const d = abs < 0.0001 ? 6 : abs < 0.01 ? 5 : 4; return `${sign}$${abs.toFixed(d)}`; }
      return `${sign}$${abs.toFixed(abs < 100 ? 2 : 0)}`;
    }
    function formatPercent(value, decimals=1, signed=false) {
      const num = Number(value);
      if (!Number.isFinite(num)) return 'n/a';
      const prefix = signed && num > 0 ? '+' : '';
      return `${prefix}${num.toFixed(decimals)}%`;
    }
    function formatPrice(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return 'n/a';
      const abs = Math.abs(num);
      // Prices should always show full number with commas, never abbreviate to K/M
      if (abs >= 1)    return `$${num.toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2})}`;
      if (abs > 0)     { const d = abs < 0.0001 ? 6 : abs < 0.01 ? 5 : 4; return `$${num.toFixed(d)}`; }
      return '$0.00';
    }
    function formatNumber(value, key='') {
      if (value === null || value === undefined || value === '') return 'n/a';
      if (typeof value === 'string' && value.trim() === '') return 'n/a';
      const k = String(key||'').toLowerCase();
      const num = typeof value === 'number' ? value : Number(String(value).replace(/,/g,''));
      if (!Number.isFinite(num)) return String(value);
      if (k.includes('pct') || k.includes('%')) return formatPercent(num, 1);
      const abs = Math.abs(num);
      if (abs >= 1e12) return `$${(num/1e12).toFixed(2)}t`;
      if (abs >= 1e9)  return `$${(num/1e9).toFixed(2)}B`;
      if (abs >= 1e6)  return `$${(num/1e6).toFixed(2)}M`;
      if (abs >= 1e3)  return `$${(num/1e3).toFixed(2)}K`;
      if (abs > 0 && abs < 1) { const d = abs < 0.0001 ? 6 : abs < 0.01 ? 5 : 4; return num.toFixed(d); }
      return num.toLocaleString(undefined, {maximumFractionDigits:2});
    }
    function formatMetricValue(label, key, value) {
      const k = String(key||label||'').toLowerCase();
      if (value === null || value === undefined || value === '') return 'n/a';
      switch (k) {
        case 'price': case 'current_price': case 'price_usd': return formatPrice(value);
        case 'market_cap': case 'total_volume': case 'fdv': case 'tvl': case 'fees_7d': case 'revenue_7d': return formatCompactNumber(value);
        case 'tvl_change_7d': case 'tvl_change_30d': return formatPercent(value,1,true);
        case 'pct_circulating': return formatPercent(value,1);
        case 'inflation_rate': return formatPercent(value,2);
        default: return formatNumber(value,k);
      }
    }
    function formatDuration(ms) {
      const s = Math.max(0, Math.round(Number(ms||0)/1000));
      if (s < 60) return `${s}s`;
      const m = Math.floor(s/60), sec = s%60;
      if (m < 60) return sec ? `${m}m ${sec}s` : `${m}m`;
      const h = Math.floor(m/60), rm = m%60;
      return rm ? `${h}h ${rm}m` : `${h}h`;
    }
    function overallScore(scores) {
      const vals = Object.values(scores||{}).map(i=>Number(i?.score)).filter(v=>Number.isFinite(v));
      if (!vals.length) return null;
      return vals.reduce((s,v)=>s+v,0)/vals.length;
    }
    function barColor(v) {
      if (v >= 8) return '#D4580A';
      if (v >= 6) return '#ffd3b6';
      if (v >= 4) return '#ffaaa5';
      return '#ff8b94';
    }
    function changeClass(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '';
      return n > 0 ? 'pos-change' : n < 0 ? 'neg-change' : '';
    }
    function formatDexPrice(priceUsd) {
      const n = parseFloat(priceUsd);
      if (!n || !isFinite(n)) return '';
      if (n >= 1000) return `$${(n/1000).toFixed(1)}K`;
      if (n >= 1)    return `$${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
      if (n > 0)     { const d = n < 0.00001 ? 8 : n < 0.001 ? 6 : 4; return `$${n.toFixed(d)}`; }
      return '';
    }
    function formatDexVol(vol) {
      const n = Number(vol);
      if (!n || !isFinite(n)) return '';
      if (n >= 1e9) return `vol $${(n/1e9).toFixed(1)}B`;
      if (n >= 1e6) return `vol $${(n/1e6).toFixed(1)}M`;
      if (n >= 1e3) return `vol $${(n/1e3).toFixed(0)}K`;
      return `vol $${n.toFixed(0)}`;
    }

    // ── Skeleton loading state (Round 2) ────────────────────────────
    function showSkeleton() {
      resultsSection.classList.add('visible');
      reportBox.classList.remove('hidden');
      errorBox.classList.add('hidden');
      reportBox.classList.remove('results-reveal');
      // Round 96: 3-panel skeleton matching real report layout
      reportBox.innerHTML = `
        <!-- Panel 1: header + analysis -->
        <div class="skeleton-panel">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
            <div style="display:grid;gap:10px;flex:1;min-width:0;">
              <div class="skeleton skeleton-line w-40" style="height:11px;"></div>
              <div class="skeleton skeleton-title"></div>
            </div>
            <div style="display:grid;gap:8px;align-items:end;">
              <div class="skeleton skeleton-badge" style="height:40px;width:110px;border-radius:999px;"></div>
              <div class="skeleton skeleton-line w-60" style="height:22px;margin-left:auto;width:60px;"></div>
            </div>
          </div>
          <!-- intro card shimmer -->
          <div class="skeleton" style="height:72px;border-radius:10px;"></div>
          <!-- analysis lines -->
          <div style="display:grid;gap:8px;margin-top:4px;">
            <div class="skeleton skeleton-line w-full"></div>
            <div class="skeleton skeleton-line w-full"></div>
            <div class="skeleton skeleton-line w-80"></div>
            <div class="skeleton skeleton-line w-full"></div>
            <div class="skeleton skeleton-line w-60"></div>
          </div>
        </div>
        <!-- Panel 2: radar + market board -->
        <div class="skeleton-panel" style="margin-top:18px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
            <div style="display:grid;gap:10px;">
              <div class="skeleton skeleton-line w-40" style="height:11px;"></div>
              <div class="skeleton" style="height:160px;border-radius:12px;"></div>
              ${[0,1,2,3,4,5].map(() => `<div class="skeleton-score" style="display:grid;grid-template-columns:110px 1fr 60px;gap:10px;padding:8px 12px;border:1px solid rgba(255,255,255,0.05);border-radius:8px;">
                <div class="skeleton skeleton-line w-full" style="height:11px;"></div>
                <div class="skeleton skeleton-bar"></div>
                <div class="skeleton skeleton-line w-full" style="height:11px;"></div>
              </div>`).join('')}
            </div>
            <div style="display:grid;gap:8px;align-content:start;">
              <div class="skeleton skeleton-line w-40" style="height:11px;"></div>
              ${[0,1,2,3,4,5,6].map((i) => `<div class="skeleton skeleton-line" style="width:${[100,70,90,55,80,65,45][i]}%;height:11px;"></div>`).join('')}
            </div>
          </div>
        </div>
        <!-- Panel 3: bull/bear -->
        <div class="skeleton-panel" style="margin-top:18px;">
          <div class="skeleton skeleton-line w-40" style="height:11px;margin-bottom:4px;"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div style="display:grid;gap:8px;padding:14px;border:1px solid rgba(34,197,94,0.12);border-radius:10px;">
              <div class="skeleton skeleton-line w-60" style="height:16px;"></div>
              ${[100,90,75,80].map(w=>`<div class="skeleton skeleton-line" style="width:${w}%;height:10px;"></div>`).join('')}
            </div>
            <div style="display:grid;gap:8px;padding:14px;border:1px solid rgba(239,68,68,0.12);border-radius:10px;">
              <div class="skeleton skeleton-line w-60" style="height:16px;"></div>
              ${[100,85,70,90].map(w=>`<div class="skeleton skeleton-line" style="width:${w}%;height:10px;"></div>`).join('')}
            </div>
          </div>
        </div>`;
    }

    // ── Loading state (Round 85: progressive contextual messages) ────
    var _loadingInterval = null;
    function setLoading(isLoading, mode) {
      const scanBtn   = document.getElementById('scan-btn');
      const quickLinkEl = document.getElementById('quick-link');

      if (isLoading) {
        if (scanBtn)    { scanBtn.disabled = true; scanBtn.textContent = 'Scanning…'; scanBtn.setAttribute('aria-busy', 'true'); }
        if (quickLinkEl) quickLinkEl.style.pointerEvents = 'none';

        const project = escapeHtml(input.value.trim() || 'project');
        const steps = mode === 'quick'
          ? ['Fetching market data…', 'Running algorithmic scoring…', 'Calculating dimensions…', 'Building report…']
          : ['Fetching market data…', 'Querying DeFiLlama TVL…', 'Scanning GitHub activity…', 'Collecting X/Twitter sentiment…', 'Running AI analysis…', 'Building report…'];
        var stepIdx = 0;

        statusBox.innerHTML = `
          <div class="loading-wrap" role="status" aria-live="polite" aria-label="Scanning ${project}">
            <div class="chalk-loading">Scanning <span class="loading-project">${project}</span><span class="loading-dots"></span></div>
            <div class="loading-bar" aria-hidden="true"></div>
            <div class="footnote" id="loading-step-label" style="transition:opacity 0.2s;">${escapeHtml(steps[0])}</div>
          </div>`;

        clearInterval(_loadingInterval);
        var stepMs = mode === 'quick' ? 2500 : 3000;
        _loadingInterval = setInterval(function() {
          stepIdx = Math.min(stepIdx + 1, steps.length - 1);
          var el = document.getElementById('loading-step-label');
          if (el) { el.style.opacity='0'; setTimeout(function(){ el.textContent=steps[stepIdx]; el.style.opacity='1'; }, 200); }
        }, stepMs);

        showSkeleton();
      } else {
        clearInterval(_loadingInterval);
        _loadingInterval = null;
        if (scanBtn)    { scanBtn.disabled = false; scanBtn.textContent = _persistedKey ? 'Full Scan' : 'Full Scan $1'; scanBtn.removeAttribute('aria-busy'); }
        if (quickLinkEl) quickLinkEl.style.pointerEvents = '';
        statusBox.innerHTML = '';
      }
    }

    // ── Radar chart ─────────────────────────────────────────────────
    // Round 74: improved radar with clearer labels, score ticks, aria title
    function renderRadar(scores) {
      const size = 380, center = size/2, radius = 100, levels = 5;
      const keys = SCORE_META.map(([k])=>k), labels = SCORE_META.map(([,l])=>l);
      const values = keys.map(k=>Number(scores?.[k]?.score||0));
      const points = values.map((v,i)=>{
        const angle = (-Math.PI/2)+(i*Math.PI*2/values.length);
        const scale = Math.max(0,Math.min(10,v))/10;
        return [center+Math.cos(angle)*radius*scale, center+Math.sin(angle)*radius*scale];
      });
      const polygon = points.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      // Grid levels with score labels only at specific levels
      const grid = Array.from({length:levels},(_,i)=>{
        const l=i+1, lr=radius*(l/levels);
        const lp=labels.map((_,j)=>{
          const a=(-Math.PI/2)+(j*Math.PI*2/labels.length);
          return `${(center+Math.cos(a)*lr).toFixed(1)},${(center+Math.sin(a)*lr).toFixed(1)}`;
        }).join(' ');
        // Show score tick on the top axis (upward direction)
        const tickX=(center+0.5).toFixed(1);
        const tickY=(center-lr-3).toFixed(1);
        const scoreLabel=l*2; // 2,4,6,8,10
        return `<polygon points="${lp}" fill="none" stroke="rgba(232,232,232,${0.06+l*0.025})" stroke-dasharray="${l===5?'none':'3 5'}" stroke-width="${l===5?'1.5':'1'}" />${l%2===0?`<text x="${tickX}" y="${tickY}" fill="rgba(232,232,232,0.4)" font-size="9.5" text-anchor="middle">${scoreLabel}</text>`:''}`;
      }).join('');
      // Axes + labels
      const axes = labels.map((label,i)=>{
        const a=(-Math.PI/2)+(i*Math.PI*2/labels.length);
        const x=(center+Math.cos(a)*radius).toFixed(1), y=(center+Math.sin(a)*radius).toFixed(1);
        const tx=(center+Math.cos(a)*(radius+38)).toFixed(1), ty=(center+Math.sin(a)*(radius+38)).toFixed(1);
        const anchor=Math.cos(a)>0.25?'start':Math.cos(a)<-0.25?'end':'middle';
        const score = values[i];
        const scoreColor = SCORE_META[i][2];
        return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="rgba(232,232,232,0.12)" stroke-width="1" /><text x="${tx}" y="${ty}" fill="#c8c8c8" font-size="11.5" font-weight="600" text-anchor="${anchor}" dominant-baseline="middle" font-family="Inter,sans-serif">${label}</text>`;
      }).join('');
      // Aria description
      const ariaLabel = `Score radar: ${SCORE_META.map(([k,l],i)=>`${l} ${values[i].toFixed(1)}`).join(', ')}`;
      return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(ariaLabel)}" style="max-width:100%;margin:0 auto;display:block;">
        <title>Score Radar Chart</title>
        <defs>
          <filter id="radar-glow-r74"><feGaussianBlur stdDeviation="4" result="blur"></feGaussianBlur><feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter>
          <radialGradient id="radarFill" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="rgba(212,88,10,0.2)"/><stop offset="100%" stop-color="rgba(212,88,10,0.06)"/></radialGradient>
        </defs>
        ${grid}${axes}
        <circle cx="${center}" cy="${center}" r="2.5" fill="rgba(255,255,255,0.25)" />
        <polygon points="${polygon}" fill="url(#radarFill)" stroke="#D4580A" stroke-width="2" filter="url(#radar-glow-r74)" />
        ${points.map(([x,y],i)=>`<g role="img" aria-label="${SCORE_META[i][1]}: ${values[i].toFixed(1)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="rgba(10,10,10,0.92)" stroke="${SCORE_META[i][2]}" stroke-width="2" /><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${SCORE_META[i][2]}" /></g>`).join('')}
      </svg>`;
    }


    function renderScoreBars(scores) {
      return SCORE_META.map(([key,label])=>{
        const v=Number(scores?.[key]?.score||0), w=`${Math.max(0,Math.min(100,v*10))}%`;
        const tone=v>=8?'High conviction':v>=6?'Constructive':v>=4?'Mixed setup':'Fragile';
        const toneColor=v>=8?'#86efac':v>=6?'#ffd3b6':v>=4?'#fdba74':'#fca5a5';
        const barC=barColor(v);
        // Round 71: score value shown prominently, tone pill on the right
        return `<div class="score-row">
          <div class="score-label">
            <strong>${label}</strong>
            <span style="color:${toneColor};font-size:0.68rem;">${tone}</span>
          </div>
          <div class="bar">
            <span style="--target-width:${w}; background:${barC}; box-shadow:0 0 8px ${barC}55"></span>
          </div>
          <div class="score-value" style="color:${barC};font-family:'IBM Plex Mono',monospace;font-size:0.95rem;">${v.toFixed(1)}</div>
        </div>`;
      }).join('');
    }

    function metricRows(raw) {
      const mp = raw?.market?.current_price ?? raw?.market?.price ?? raw?.market?.price_usd;
      const rows = [
        ['Price','price',mp,null],
        ['Market cap','market_cap',raw?.market?.market_cap,null],
        ['24h volume','total_volume',raw?.market?.total_volume,null],
        ['FDV','fdv',raw?.market?.fully_diluted_valuation ?? raw?.market?.fdv,null],
        ['TVL','tvl',raw?.onchain?.tvl,null],
        ['7d TVL %','tvl_change_7d',raw?.onchain?.tvl_change_7d,'change'],
        ['30d TVL %','tvl_change_30d',raw?.onchain?.tvl_change_30d,'change'],
        ['Fees 7d','fees_7d',raw?.onchain?.fees_7d,null],
        ['Revenue 7d','revenue_7d',raw?.onchain?.revenue_7d,null],
        ['Mentions','mentions',raw?.social?.mentions,null],
        ['Commits 90d','commits_90d',raw?.github?.commits_90d,null],
        ['Contributors','contributors',raw?.github?.contributors,null],
        ['Pct circulating','pct_circulating',raw?.tokenomics?.pct_circulating,null],
        ['Inflation rate','inflation_rate',raw?.tokenomics?.inflation_rate,null],
      ];
      return rows.filter(([,,value])=> value !== null && value !== undefined && value !== '' && value !== 'N/A' && value !== 'n/a').map(([label,key,value,type])=>{
        const cls=type==='change'?` class="${changeClass(value)}"`:''
        return `<tr><th>${escapeHtml(label)}</th><td data-label="${escapeHtml(label)}"${cls}>${escapeHtml(formatMetricValue(label,key,value))}</td></tr>`;
      }).join('');
    }

    function renderGithubCard(github) {
      if (!github||github.error) return '';
      const lang=github.language?`<span class="lang-badge">${escapeHtml(github.language)}</span>`:'';
      const desc=github.description?`<p class="github-desc">${escapeHtml(github.description)}</p>`:'';
      const lic=github.license?`<span class="license-badge">${escapeHtml(github.license)}</span>`:'';
      const url=github.repo_url?`<a href="${escapeHtml(github.repo_url)}" target="_blank" rel="noopener" class="repo-link">↗ View Repo</a>`:'';
      return `<div class="github-card"><div class="github-card-header"><span class="github-icon">⌥</span><span class="github-title">Repository</span>${url}</div>${desc}<div class="github-badges">${lang}${lic}${github.stars!=null?`<span class="stat-badge">★ ${Number(github.stars).toLocaleString()}</span>`:''} ${github.watchers!=null?`<span class="stat-badge">👁 ${Number(github.watchers).toLocaleString()}</span>`:''}</div></div>`;
    }

    function humanizeLabel(snakeCase) {
      if (!snakeCase) return snakeCase;
      const labels = {
        'young_project': 'Limited track record',
        'low_market_cap': 'Extremely low market cap',
        'no_github': 'Unverifiable development activity',
        'github_inactive': 'No recent development activity',
        'dev_quality_concern': 'Development quality concerns',
        'whale_concentration': 'High whale concentration',
        'high_concentration': 'High holder concentration',
        'no_onchain_data': 'No on-chain data',
        'declining_tvl': 'Declining protocol TVL',
        'low_volume': 'Very low trading volume',
        'bearish_sentiment': 'Overwhelmingly bearish sentiment',
        'zero_social_mentions': 'No recent social mentions',
        'no_license': 'Unlicensed codebase',
        'extreme_fdv_ratio': 'Extreme token unlock overhang',
        'exploit_mentions_social': 'Exploit mentions in social media',
        'low_revenue_capture': 'Low revenue capture',
        'zero_revenue_capture': 'Zero revenue capture',
        'very_low_revenue_efficiency': 'Very low revenue efficiency',
        'token_unlock_news': 'Token unlock events',
        'regulatory_risk_mentions': 'Regulatory risk mentions',
        'near_all_time_low': 'Near all-time low',
        'atl_proximity': 'ATL proximity',
        'flash_crash': 'Flash crash detected',
        'unverified_contract': 'Unverified contract',
        'dex_sell_pressure': 'DEX sell pressure dominance',
        'dex_dump_pattern': 'DEX dump pattern detected',
        'dex_pump_pattern': 'DEX pump-and-dump pattern',
        'no_dex_pairs': 'No DEX liquidity pairs',
        'very_low_dex_liquidity': 'Critically low DEX liquidity',
        'very_low_exchange_count': 'Very few exchange listings',
        'high_inflation': 'High token inflation rate',
        'hyperinflationary': 'Hyperinflationary token supply',
        'high_team_allocation': 'Excessive team token allocation',
        'severe_price_decline': 'Severe recent price decline',
        'single_chain_tvl_concentration': 'TVL concentrated on single chain',
        'single_pool_liquidity_concentration': 'Liquidity concentrated in single pool',
        'stablecoin_depeg': 'Stablecoin depeg risk',
        'uneven_dimension_scores': 'Uneven score profile',
        'zombie_protocol': 'Zombie protocol',
        'recent_release': 'Recent release',
        'dev_acceleration': 'Accelerating development velocity',
        'improving_sector_position': 'Improving sector standing',
        'multi_exchange_listing': 'Broad exchange distribution',
        'tvl_growth_spike': 'Strong TVL inflow',
        'coingecko_trending': 'CoinGecko trending',
        'strong_dex_presence': 'Strong DEX presence',
        'dex_buy_pressure': 'DEX buy pressure',
        'institutional_interest': 'Institutional interest',
        'partnership_news': 'Partnership news',
        'high_cex_volume_share': 'High CEX volume share',
        'strong_dex_liquidity_health': 'Strong DEX liquidity health',
        'flash_pump': 'Flash pump detected',
        'ath_breakout': 'ATH breakout',
        'near_ath_breakout': 'Near ATH breakout attempt',
        'recovery_from_low': 'Recovery from low',
        'atl_recovery_momentum': 'Recovery momentum from all-time low',
        'volume_surge': 'Volume surge',
        'volume_spike_no_price_move': 'Unusual volume without price reaction',
        'strong_positive_sentiment': 'Strong positive sentiment',
        'price_volume_divergence': 'Price-volume divergence',
        'price_volume_divergence_bullish': 'Bullish price-volume divergence',
        'multi_chain_presence': 'Multi-chain presence',
        'multichain_expansion': 'Multi-chain expansion activity',
        'ecosystem_growth': 'Ecosystem growth',
        'active_governance': 'Active governance participation',
        'revenue_generating': 'Fee/revenue generation confirmed',
        'strong_revenue_capture': 'Strong protocol revenue capture',
        'high_fee_efficiency': 'High fee-to-TVL efficiency',
        'low_price_to_tvl': 'Undervalued relative to TVL',
        'strong_treasury': 'Strong protocol treasury',
        'strong_long_term_trend': 'Sustained long-term uptrend',
        'accelerating_news_coverage': 'Accelerating news coverage',
      };
      return labels[snakeCase] || snakeCase.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function formatAnalysisText(text) {
      if (!text) return '<p>No analysis available.</p>';
      // Split into paragraphs on double newline or single newline
      const paragraphs = text.split(/\n\n+|\n(?=[A-Z])/).filter(p => p.trim());
      if (paragraphs.length <= 1) {
        // Try splitting long single-paragraph text at sentence boundaries (~every 2-3 sentences)
        const sentences = text.match(/.+?[!?]+|.+?\.(?!\d)/g) || [text];
        if (sentences.length > 4) {
          const chunks = [];
          for (let i = 0; i < sentences.length; i += 3) {
            chunks.push(sentences.slice(i, i + 3).join(' ').trim());
          }
          return chunks.map(p => `<p style="margin:0 0 12px 0;line-height:1.8;">${escapeHtml(p)}</p>`).join('');
        }
      }
      return paragraphs.map(p => `<p style="margin:0 0 12px 0;line-height:1.8;">${escapeHtml(p.trim())}</p>`).join('');
    }

    function renderList(items, fallback='n/a') {
      if (!Array.isArray(items)||!items.length) return `<li>${escapeHtml(fallback)}</li>`;
      return items.map(i=>`<li>${escapeHtml(i)}</li>`).join('');
    }

    function renderProjectIntro(payload, analysis, raw) {
      const projectName = payload?.project_name || 'this project';
      const summary = String(analysis?.project_summary || payload?.project_summary || '').trim();
      const category = String(analysis?.project_category || payload?.project_category || raw?.onchain?.category || '').trim();
      // Round 72: also surface ticker + chain + website if available
      const ticker = raw?.market?.symbol ? `<span style="font-family:'IBM Plex Mono',monospace;color:var(--muted);font-size:0.82rem;padding:2px 8px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:6px;">${escapeHtml(raw.market.symbol.toUpperCase())}</span>` : '';
      const website = raw?.market?.links?.homepage?.[0] || raw?.tokenomics?.links?.homepage || '';
      const websiteLink = website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener" style="font-size:0.78rem;color:var(--muted2);display:inline-flex;align-items:center;gap:4px;">↗ Website</a>` : '';

      if (!summary && !category) return '';

      return `<div class="project-intro-panel" style="margin:18px 0;">
        <div class="project-intro-card">
          <div class="project-intro-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span>📋 What is ${escapeHtml(projectName)}?</span>
            ${ticker}
            ${websiteLink}
          </div>
          ${summary ? `<div class="project-intro-text" style="margin-top:10px;">${formatAnalysisText(summary)}</div>` : ''}
          ${category ? `<div class="project-intro-meta" style="margin-top:8px;">Category: <span class="project-category-badge">${escapeHtml(category)}</span></div>` : ''}
        </div>
      </div>`;
    }

    // ── Trade Chart SVG (TradingView-style) ──────────────────────────
    function renderTradeChart(history90d, sparkline, tradeSetup, riskReward) {
      // Use 90d history if available, fallback to 7d sparkline
      const histData = Array.isArray(history90d) && history90d.length > 5 ? history90d : null;
      const prices = histData
        ? histData.map(d => d.p).filter(p => typeof p === 'number' && isFinite(p))
        : (Array.isArray(sparkline) ? sparkline.filter(p => typeof p === 'number' && isFinite(p)) : []);
      const timestamps = histData ? histData.map(d => d.t) : null;
      if (!prices.length || !tradeSetup?.entry_zone?.low) return '';

      const W = 660, H = 320;
      const padL = 10, padR = 78, padT = 20, padB = 36;
      const chartW = W - padL - padR;
      const chartH = H - padT - padB;

      const entryLow  = Number(tradeSetup.entry_zone.low);
      const entryHigh = Number(tradeSetup.entry_zone.high);
      const sl        = Number(tradeSetup.stop_loss || 0);
      const tps       = tradeSetup.take_profit_targets || [];
      const tp1Price  = tps[0] ? Number(tps[0].price) : null;
      const tp2Price  = tps[1] ? Number(tps[1].price) : null;
      const rrRatio   = tradeSetup.risk_reward_ratio ?? riskReward?.risk_reward_ratio ?? null;

      const sparkMin = Math.min(...prices);
      const sparkMax = Math.max(...prices);
      const allLevels = [sparkMin, sparkMax, entryLow, entryHigh];
      if (sl > 0) allLevels.push(sl);
      if (tp1Price) allLevels.push(tp1Price);
      if (tp2Price) allLevels.push(tp2Price);
      const minPrice = Math.min(...allLevels) * 0.97;
      const maxPrice = Math.max(...allLevels) * 1.03;
      const priceRange = maxPrice - minPrice || 1;

      function py(price) {
        return padT + (1 - (price - minPrice) / priceRange) * chartH;
      }
      function px(i, total) {
        return padL + (i / (total - 1)) * chartW;
      }
      function fmtPrice(p) {
        if (p >= 1000) return `$${(p/1000).toFixed(1)}k`;
        if (p >= 1) return `$${p.toFixed(2)}`;
        return `$${p.toFixed(p < 0.001 ? 6 : 4)}`;
      }

      // Grid lines (5 levels)
      const gridLines = [];
      for (let i = 0; i <= 4; i++) {
        const price = minPrice + (priceRange * i / 4);
        const y = py(price);
        gridLines.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#282828" stroke-width="1"/>`);
        gridLines.push(`<text x="${W - padR + 5}" y="${(y + 4).toFixed(1)}" fill="#666" font-size="9.5" font-family="Inter,monospace">${fmtPrice(price)}</text>`);
      }

      // X-axis labels (date-based if timestamps available)
      const xAxisY = H - 6;
      let xAxisItems = '';
      if (timestamps && timestamps.length) {
        const nLabels = 5;
        const step = Math.floor((timestamps.length - 1) / (nLabels - 1));
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        xAxisItems = Array.from({length: nLabels}, (_, i) => {
          const idx = Math.min(i * step, timestamps.length - 1);
          const d = new Date(timestamps[idx]);
          const lbl = `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
          const x = px(idx, prices.length);
          return `<text x="${x.toFixed(1)}" y="${xAxisY}" fill="#666" font-size="9.5" font-family="Inter,sans-serif" text-anchor="middle">${lbl}</text>`;
        }).join('');
      } else {
        const xLabels = ['7d ago','5d','3d','1d','Now'];
        xAxisItems = xLabels.map((lbl, i) => {
          const x = padL + (i / (xLabels.length - 1)) * chartW;
          return `<text x="${x.toFixed(1)}" y="${xAxisY}" fill="#666" font-size="9.5" font-family="Inter,sans-serif" text-anchor="middle">${lbl}</text>`;
        }).join('');
      }

      // Price polyline
      const pts = prices.map((p, i) => `${px(i, prices.length).toFixed(1)},${py(p).toFixed(1)}`).join(' ');
      const lastX = px(prices.length - 1, prices.length);
      const lastY = py(prices[prices.length - 1]);
      const firstX = px(0, prices.length);
      const baseY = padT + chartH;
      const areaPath = `M${firstX.toFixed(1)},${baseY} L${prices.map((p, i) => `${px(i, prices.length).toFixed(1)},${py(p).toFixed(1)}`).join(' L')} L${lastX.toFixed(1)},${baseY} Z`;

      // SL zone
      const slZone = sl > 0 ? (() => {
        const y1 = Math.min(py(entryLow), py(sl));
        const y2 = Math.max(py(entryLow), py(sl));
        const slPct = entryLow > 0 ? (((sl - entryLow) / entryLow) * 100).toFixed(1) : '?';
        const labelY = ((y1 + y2) / 2 + 4).toFixed(1);
        return `<rect x="${padL}" y="${y1.toFixed(1)}" width="${chartW}" height="${(y2 - y1).toFixed(1)}" fill="rgba(239,68,68,0.08)"/>
        <line x1="${padL}" y1="${py(sl).toFixed(1)}" x2="${W - padR}" y2="${py(sl).toFixed(1)}" stroke="#ef4444" stroke-width="1" stroke-dasharray="6 3"/>
        <text x="${(W - padR + 5).toFixed(1)}" y="${(py(sl) + 4).toFixed(1)}" fill="#f87171" font-size="9.5" font-family="Inter,monospace">SL ${fmtPrice(sl)}</text>`;
      })() : '';

      // Entry zone
      const entryY1 = Math.min(py(entryLow), py(entryHigh));
      const entryY2 = Math.max(py(entryLow), py(entryHigh));
      const entryMidY = ((entryY1 + entryY2) / 2).toFixed(1);
      const entryZoneSvg = `<rect x="${padL}" y="${entryY1.toFixed(1)}" width="${chartW}" height="${(Math.max(entryY2 - entryY1, 2)).toFixed(1)}" fill="rgba(45,212,191,0.08)" stroke="rgba(45,212,191,0.4)" stroke-width="1" stroke-dasharray="4 3"/>`;
      const entryLabel = `<text x="${(W - padR + 5).toFixed(1)}" y="${(Number(entryMidY) + 4).toFixed(1)}" fill="rgba(45,212,191,0.9)" font-size="9.5" font-family="Inter,monospace">Entry ${fmtPrice((entryLow+entryHigh)/2)}</text>`;

      // TP1 zone
      const tp1Zone = tp1Price ? (() => {
        const y1 = Math.min(py(entryHigh), py(tp1Price));
        const y2 = Math.max(py(entryHigh), py(tp1Price));
        const tp1Pct = entryHigh > 0 ? `+${(((tp1Price - entryHigh) / entryHigh) * 100).toFixed(1)}%` : '';
        return `<rect x="${padL}" y="${y1.toFixed(1)}" width="${chartW}" height="${(y2 - y1).toFixed(1)}" fill="rgba(34,197,94,0.06)"/>
        <line x1="${padL}" y1="${py(tp1Price).toFixed(1)}" x2="${W - padR}" y2="${py(tp1Price).toFixed(1)}" stroke="#22c55e" stroke-width="1" stroke-dasharray="6 3"/>
        <text x="${(W - padR + 5).toFixed(1)}" y="${(py(tp1Price) + 4).toFixed(1)}" fill="#86efac" font-size="9.5" font-family="Inter,monospace">TP1 ${fmtPrice(tp1Price)}</text>`;
      })() : '';

      // TP2 dashed line
      const tp2Line = tp2Price ? (() => {
        const y = py(tp2Price).toFixed(1);
        return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(134,239,172,0.4)" stroke-width="1" stroke-dasharray="5 4"/>
        <text x="${(W - padR + 5).toFixed(1)}" y="${(Number(y) + 4).toFixed(1)}" fill="#86efac" font-size="9.5" font-family="Inter,monospace">TP2 ${fmtPrice(tp2Price)}</text>`;
      })() : '';

      return `<div class="trade-chart">
        <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-label="90-day price chart with trade levels" role="img">
          ${gridLines.join('')}
          ${slZone}
          ${tp1Zone}
          ${tp2Line}
          ${entryZoneSvg}
          ${entryLabel}
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(255,255,255,0.06)"/>
              <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
            </linearGradient>
          </defs>
          <path d="${areaPath}" fill="url(#areaGrad)"/>
          <polyline points="${pts}" fill="none" stroke="#e8e8e8" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" fill="#D4580A" stroke="#0a0a0a" stroke-width="1.5"/>
          ${xAxisItems}
        </svg>
      </div>`;
    }

    // ── Probability badge helper ─────────────────────────────────────
    function probBadge(probability) {
      if (!probability) return '';
      const p = String(probability).toLowerCase();
      const cls = p.includes('low') ? 'prob-low' : p.includes('high') ? 'prob-high' : 'prob-medium';
      return `<span class="probability-badge ${cls}">${escapeHtml(probability)}</span>`;
    }

    function renderReport(payload) {
      const verdict   = payload?.verdict || 'HOLD';
      const raw       = payload?.raw_data || {};
      const analysis  = payload?.llm_analysis || {};
      const scores    = payload?.scores || {};
      const cache     = payload?.cache || {};
      const avgScore  = overallScore(scores);
      const hasAnalysis = !!String(analysis?.analysis_text || '').trim();

      resultsSection.classList.add('visible');
      errorBox.classList.add('hidden');
      reportBox.classList.remove('hidden');
      // Trigger smooth reveal animation (Round 2)
      reportBox.classList.add('results-reveal');

      // ── Panel 1: Header + Verdict + Analysis ─────────────────────
      const panel1 = `<section class="panel">
        <div class="header-row">
          <div>
            <div class="footnote">${escapeHtml(payload?.mode||'full')} scan</div>
            <h1 class="project-name">${escapeHtml(payload?.project_name||'Unknown')}</h1>
          </div>
          <div class="verdict-wrap">
            <div class="verdict-meta">Research verdict</div>
            <div class="verdict ${verdictClass(verdict)}">${escapeHtml(verdict)}</div>
            <div class="overall-score ${verdictClass(verdict)}">${avgScore!==null?`${avgScore.toFixed(1)}/10`:'n/a'}</div>
            ${(()=>{const v=payload?.volatility;if(!v||v.regime==='calm')return'';const c={elevated:'#fbbf24',high:'#f97316',extreme:'#ef4444'}[v.regime]||'#fbbf24';const pct=v.volatility_pct_24h!=null?` (${v.volatility_pct_24h.toFixed(1)}% 24h)`:'';return`<div style="margin-top:6px;padding:4px 12px;background:${c};color:#000;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;display:inline-block;">⚡ ${v.regime}${pct}</div>`})()}
            ${(()=>{const sa=scores?.overall?.score_anomaly;if(!sa||sa==='normal')return'';return`<div style="margin-top:4px;padding:3px 10px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;border-radius:999px;font-size:10px;font-weight:600;display:inline-block;">⚠ ${sa==='high_variance'?'uneven scores':'mixed signals'}</div>`})()}
          </div>
        </div>
        ${renderProjectIntro(payload, analysis, raw)}
        <div class="analysis ${hasAnalysis ? '' : 'analysis-error-state'}">${hasAnalysis ? formatAnalysisText(analysis.analysis_text) : '<p style="margin:0;line-height:1.8;">Oops, something went wrong — we couldn\'t generate the analysis for this project. Try again.</p>'}</div>
      </section>`;

      // ── Panel 2: Score Radar + Market Board (2-col grid) ─────────
      const mr = metricRows(raw);
      const gc = renderGithubCard(raw?.github);
      const panel2 = `<section class="panel" style="margin-top:18px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;" class="radar-market-grid">
          <div>
            <div class="section-label">Score Radar</div>
            ${renderRadar(scores)}
            <div class="score-list">${renderScoreBars(scores)}</div>
          </div>
          <div>
            ${mr||gc ? `<div class="section-label">Market Board</div>
            ${mr?`<table class="table"><tbody>${mr}</tbody></table>`:''}
            ${gc}` : '<div class="section-label" style="color:var(--muted);">No market data</div>'}
          </div>
        </div>
      </section>`;

      // ── Panel 3: Bull Case / Bear Case ───────────────────────────
      const llmBull = analysis?.bull_case;
      const llmBear = analysis?.bear_case;
      const thesis  = payload?.thesis;
      // Gather signals/findings/flags for integration into bull/bear
      const alphaSignals = payload?.alpha_signals || [];
      // key_findings merged into alpha signals grouping — no separate rendering
      const redFlags = payload?.red_flags || [];
      const critFlags = redFlags.filter(f=>f.severity==='critical');
      const warnFlags = redFlags.filter(f=>f.severity==='warning');
      // Group & condense alpha signals into max ~3-4 thematic bullets
      const signalGroups = {};
      const groupMap = {
        volume: /volume|vol.mcap|accumulation|trading.activity/i,
        liquidity: /liquidity|dex.pair|dex.presence|exchange.dist|cex.volume/i,
        development: /release|commit|github|shipping|dev/i,
        sentiment: /sentiment|kol|bullish|trending|attention|news.*interest|institutional/i,
        onchain: /buy.pressure|buy.sell|whale|holder|on.chain|dex.buy/i,
      };
      for (const s of alphaSignals) {
        const key = Object.keys(groupMap).find(k => groupMap[k].test(s.signal + ' ' + s.detail)) || 'other';
        if (!signalGroups[key]) signalGroups[key] = [];
        signalGroups[key].push(s);
      }
      // Pick the strongest signal from each group, max 4 groups
      const groupLabels = { volume: '📊 Volume', liquidity: '💧 Liquidity', development: '🛠️ Dev Activity', sentiment: '🔥 Sentiment', onchain: '⛓️ On-chain', other: '📡 Signal' };
      const condensedSignals = Object.entries(signalGroups).slice(0, 4).map(([group, signals]) => {
        const sorted = signals.sort((a, b) => (a.strength === 'strong' ? 0 : 1) - (b.strength === 'strong' ? 0 : 1));
        const best = sorted[0];
        const extra = sorted.length > 1 ? ` <span style="color:#7e7e7e;font-size:0.75rem;">(+${sorted.length - 1} more)</span>` : '';
        return { group, label: groupLabels[group] || '📡', detail: best.detail, strength: best.strength, extra, count: sorted.length };
      });


      const xSentiment = analysis?.x_sentiment_summary && analysis.x_sentiment_summary !== 'n/a';

      let panel3 = '';
      if (llmBull || llmBear) {
        const bullCol = `<div class="bull-col">
          <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 10px;">🐂 Bull Case${probBadge(llmBull?.probability)}</h3>
          ${llmBull?.thesis ? `<p class="thesis">${escapeHtml(llmBull.thesis)}</p>` : ''}
          ${llmBull?.catalysts?.length ? `<h4 style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#86efac;margin:12px 0 6px;">Catalysts</h4><ul>${llmBull.catalysts.map(c=>`<li>${escapeHtml(c)}</li>`).join('')}</ul>` : ''}
          ${condensedSignals.length ? `<h4 style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#86efac;margin:12px 0 6px;">🚀 Alpha Signals</h4><ul>${condensedSignals.map(s=>`<li>${s.label} <span style="color:var(--text);font-size:0.88rem;">${escapeHtml(s.detail)}</span>${s.extra}</li>`).join('')}</ul>` : ''}
          ${llmBull?.target_conditions ? `<div class="conditions"><strong>Target conditions:</strong> ${escapeHtml(llmBull.target_conditions)}</div>` : ''}
        </div>`;
        const bearCol = `<div class="bear-col">
          <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 10px;">🐻 Bear Case${probBadge(llmBear?.probability)}</h3>
          ${llmBear?.thesis ? `<p class="thesis">${escapeHtml(llmBear.thesis)}</p>` : ''}
          ${llmBear?.risks?.length ? `<h4 style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#f87171;margin:12px 0 6px;">Risks</h4><ul>${llmBear.risks.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
          ${critFlags.length ? `<h4 style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#ef4444;margin:12px 0 6px;">🚨 Critical Flags</h4><ul>${critFlags.map(f=>`<li style="color:#fca5a5;"><strong>${escapeHtml(humanizeLabel(f.flag))}</strong>: ${escapeHtml(f.detail)}</li>`).join('')}</ul>` : ''}
          ${warnFlags.length ? `<h4 style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#f97316;margin:12px 0 6px;">⚠ Warnings</h4><ul>${warnFlags.map(f=>`<li style="color:#fdba74;"><strong>${escapeHtml(humanizeLabel(f.flag))}</strong>: ${escapeHtml(f.detail)}</li>`).join('')}</ul>` : ''}

          ${llmBear?.failure_conditions ? `<div class="conditions"><strong>Failure conditions:</strong> ${escapeHtml(llmBear.failure_conditions)}</div>` : ''}
        </div>`;
        // X Sentiment as full-width row under bull/bear
        const xRow = xSentiment ? `<div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06);"><span style="font-size:0.78rem;font-weight:700;color:#c5c5c5;text-transform:uppercase;letter-spacing:0.08em;">𝕏 Sentiment</span><div style="margin-top:6px;font-size:0.88rem;line-height:1.65;color:var(--text);">${formatAnalysisText(analysis.x_sentiment_summary)}</div></div>` : '';
        panel3 = `<section class="panel" style="margin-top:18px;">
          <div class="section-label">📊 Bull / Bear Analysis</div>
          <div class="bull-bear-grid">${bullCol}${bearCol}</div>
          ${xRow}
        </section>`;
      } else if (thesis) {
        // Fallback: old thesis format
        const bullText = thesis.bull_case || analysis.moat || 'n/a';
        const bearText = thesis.bear_case || (Array.isArray(analysis.risks) ? analysis.risks.join('. ') : 'n/a');
        const catalysts = Array.isArray(analysis.catalysts) ? analysis.catalysts : [];
        const risks = Array.isArray(analysis.risks) ? analysis.risks : [];
        panel3 = `<section class="panel" style="margin-top:18px;">
          <div class="section-label" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">📊 Bull / Bear Analysis${thesis.one_liner?`<span style="font-size:0.75rem;padding:2px 10px;background:rgba(212,88,10,0.12);border:1px solid rgba(212,88,10,0.3);border-radius:999px;color:#ffd3b6;margin-left:auto;">${escapeHtml(thesis.one_liner)}</span>`:''}</div>
          <div class="bull-bear-grid">
            <div class="bull-col">
              <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 10px;">🐂 Bull Case</h3>
              <p class="thesis">${escapeHtml(bullText)}</p>
              ${catalysts.length ? `<h4 style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#86efac;margin:12px 0 6px;">Catalysts</h4><ul>${catalysts.map(c=>`<li>${escapeHtml(c)}</li>`).join('')}</ul>` : ''}
            </div>
            <div class="bear-col">
              <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 10px;">🐻 Bear Case</h3>
              <p class="thesis">${escapeHtml(bearText)}</p>
              ${risks.length ? `<h4 style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#f87171;margin:12px 0 6px;">Risks</h4><ul>${risks.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
            </div>
          </div>
        </section>`;
      } else if (analysis.moat || Array.isArray(analysis.risks) || Array.isArray(analysis.catalysts)) {
        // Minimal fallback: just moat/risks/catalysts
        const catalysts = Array.isArray(analysis.catalysts) ? analysis.catalysts : [];
        const risks = Array.isArray(analysis.risks) ? analysis.risks : [];
        panel3 = `<section class="panel" style="margin-top:18px;">
          <div class="section-label">📊 Bull / Bear Analysis</div>
          <div class="bull-bear-grid">
            <div class="bull-col">
              <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 10px;">🐂 Bull Case</h3>
              ${analysis.moat ? `<p class="thesis"><strong>Moat:</strong> ${escapeHtml(analysis.moat)}</p>` : ''}
              ${catalysts.length ? `<h4 style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#86efac;margin:12px 0 6px;">Catalysts</h4><ul>${catalysts.map(c=>`<li>${escapeHtml(c)}</li>`).join('')}</ul>` : ''}
            </div>
            <div class="bear-col">
              <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 10px;">🐻 Bear Case</h3>
              ${risks.length ? `<h4 style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#f87171;margin:12px 0 6px;">Risks</h4><ul>${risks.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul>` : '<p class="thesis" style="color:var(--muted);">No risk data available.</p>'}
            </div>
          </div>
        </section>`;
      }

      // ── Panel 4: Trade Setup + TradingView Chart ─────────────────
      const ts = payload?.trade_setup;
      const rr = payload?.risk_reward;
      let panel4 = '';
      if (ts && ts.entry_zone?.low) {
        const qualColor = {strong:'#22c55e',moderate:'#fbbf24',weak:'#ef4444'}[ts.setup_quality]||'#e8e8e8';
        const history90d = raw?.market?.price_history_90d || [];
        const sparkline = raw?.market?.sparkline_7d || [];
        const chartSvg = renderTradeChart(history90d, sparkline, ts, rr);
        // Round 81: cleaner trade setup tile grid with color-coded borders
        function tradeTile(label, val, color, bg) {
          return `<div style="background:${bg||'rgba(255,255,255,0.03)'};border:1px solid ${color||'var(--border)'};border-radius:10px;padding:10px 14px;min-width:100px;text-align:center;flex:1;">
            <div style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">${escapeHtml(label)}</div>
            <div style="font-weight:700;color:${color||'var(--text)'};font-size:0.95rem;">${val}</div>
          </div>`;
        }
        const setupTiles = [
          tradeTile('Entry Zone', `$${escapeHtml(String(ts.entry_zone.low))} – $${escapeHtml(String(ts.entry_zone.high))}`, 'rgba(45,212,191,0.6)', 'rgba(45,212,191,0.04)'),
          tradeTile('Stop Loss', `$${escapeHtml(String(ts.stop_loss??'n/a'))}`, 'rgba(239,68,68,0.7)', 'rgba(239,68,68,0.04)'),
          ...(ts.take_profit_targets||[]).slice(0,2).map(tp=>tradeTile(escapeHtml(tp.label), `$${escapeHtml(String(tp.price))}<span style="font-size:10px;color:#7e7e7e;font-weight:400;"> +${escapeHtml(String(tp.pct_gain))}%</span>`, '#86efac', 'rgba(34,197,94,0.04)')),
          ts.risk_reward_ratio!=null ? tradeTile('R/R', `${escapeHtml(String(ts.risk_reward_ratio))}x`, qualColor, '') : '',
          rr?.position_size_suggestion ? tradeTile('Position Size', escapeHtml(rr.position_size_suggestion), '#fbbf24', 'rgba(251,191,36,0.04)') : '',
        ].filter(Boolean).join('');
        panel4 = `<section class="panel" style="margin-top:18px;">
          <div class="section-label">📐 Trade Setup</div>
          ${chartSvg}
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;">${setupTiles}</div>
          <div style="margin-top:8px;font-size:0.78rem;color:var(--muted);">Not financial advice. Use as a research tool only.</div>
        </section>`;
      }

      // Panel 5 removed — signals/findings/flags integrated into bull/bear panel

      // ── Panel 5: Footer / Data Reliability ───────────────────────
      const dg = analysis?.data_gaps || payload?.data_gaps || [];
      const vw = payload?._validation?.warnings || [];
      const ds = payload?._validation?.data_sources_available || [];
      const rq = payload?.report_quality;
      // Also include competitor comparison in footer if present
      const compComp = analysis.competitor_comparison && analysis.competitor_comparison !== 'n/a' ? `<div style="margin-bottom:8px;font-size:0.82rem;color:#94a3b8;"><strong style="color:#c5c5c5;">Competitors:</strong> ${escapeHtml(analysis.competitor_comparison)}</div>` : '';
      // Round 82: cleaner quality footer with confidence bar
      const gradeColor = rq ? (rq.grade==='A'?'#22c55e':rq.grade==='B'?'#86efac':rq.grade==='C'?'#fbbf24':rq.grade==='D'?'#f97316':'#ef4444') : null;
      const qScore = rq?.quality_score ?? rq?.score ?? 0;
      const confColor = rq?.verdict_confidence==='high'?'#22c55e':rq?.verdict_confidence==='medium'?'#fbbf24':'#f87171';
      const panel6 = `<section class="panel" style="margin-top:18px;border-color:rgba(255,255,255,0.06);">
        <div style="display:grid;gap:10px;">
          ${rq ? `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;">Data quality</span>
              <strong style="font-size:1rem;color:${gradeColor}">${escapeHtml(rq.grade)}</strong>
              <span style="font-size:0.75rem;color:var(--muted);">${qScore}/100</span>
            </div>
            ${rq.verdict_confidence ? `<span style="font-size:0.72rem;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,0.04);border:1px solid ${confColor}33;color:${confColor};">confidence: ${escapeHtml(rq.verdict_confidence)}</span>` : ''}
          </div>
          <div style="height:4px;background:rgba(255,255,255,0.05);border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${qScore}%;background:${gradeColor};border-radius:999px;transition:width 1s ease;"></div>
          </div>` : ''}
          ${compComp}
          ${ds.length ? `<div style="font-size:0.75rem;color:#86efac;display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="opacity:0.7;">✓ Sources:</span>${ds.map(s=>`<span style="padding:1px 7px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.15);border-radius:999px;">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
          ${dg.length ? `<div style="font-size:0.75rem;color:#fbbf24;">⚠ Data gaps: ${dg.map(g=>escapeHtml(g)).join(' · ')}</div>` : ''}
          ${vw.length ? `<div style="font-size:0.75rem;color:#f97316;">🔍 ${vw.map(w=>escapeHtml(w)).join(' · ')}</div>` : ''}
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding-top:6px;border-top:1px solid var(--border);">
            <div class="footnote">Powered by Claude Opus 4.6 + Grok Fast + CoinGecko + DeFiLlama</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button id="share-report-btn" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:5px 12px;font-size:0.75rem;cursor:pointer;font-family:inherit;transition:border-color 0.2s,color 0.2s;" onmouseover="this.style.borderColor='rgba(255,255,255,0.2)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='';this.style.color=''">⇪ Share</button>
              <button onclick="window.scrollTo({top:0,behavior:'smooth'})" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:5px 12px;font-size:0.75rem;cursor:pointer;font-family:inherit;transition:border-color 0.2s,color 0.2s;" onmouseover="this.style.borderColor='rgba(255,255,255,0.2)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='';this.style.color=''">↑ New scan</button>
            </div>
          </div>
        </div>
      </section>`;

      reportBox.innerHTML = panel1 + panel2 + panel3 + panel4 + panel6;
      // Round 91: Share button — copy URL to clipboard with toast feedback
      const shareBtn = document.getElementById('share-report-btn');
      if (shareBtn) {
        shareBtn.addEventListener('click', () => {
          const url = location.href;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => {
              if (window.showToast) showToast('Link copied to clipboard!', 'success');
            }).catch(() => {
              if (window.showToast) showToast('Copy not supported in this browser', 'error');
            });
          } else {
            // Fallback: select + execCommand
            const ta = document.createElement('textarea');
            ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); if (window.showToast) showToast('Link copied!', 'success'); }
            catch(_) { if (window.showToast) showToast('Could not copy link', 'error'); }
            document.body.removeChild(ta);
          }
        });
      }

      // Rescan button — wired via event delegation (no inline handlers)
      const rescanBtn = document.createElement('button');
      rescanBtn.textContent = '🔄 Rescan this project';
      rescanBtn.className = 'rescan-btn';
      rescanBtn.addEventListener('click', () => runScan(_persistedKey ? 'full' : 'quick'));
      reportBox.insertBefore(rescanBtn, reportBox.firstChild);
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Round 89: focus management for screen readers
      setTimeout(() => {
        var nameEl = reportBox.querySelector('.project-name');
        if (nameEl) { nameEl.setAttribute('tabindex', '-1'); nameEl.focus({ preventScroll: true }); }
      }, 650);
    }

    function showError(msg, hint) {
      resultsSection.classList.add('visible');
      errorBox.classList.remove('hidden');
      const hintHtml = hint ? `<div style="margin-top:8px;font-size:0.82rem;color:var(--muted);">${escapeHtml(hint)}</div>` : '';
      const quickHtml = `<div style="margin-top:12px;font-size:0.82rem;">
        <a href="#" id="errorQuickLink" style="color:var(--buy);text-decoration:underline;">Try free quick scan instead →</a>
      </div>`;
      errorBox.innerHTML = `<div class="error"><strong>⚠ Scan failed:</strong> ${escapeHtml(msg)}${hintHtml}${quickHtml}</div>`;
      document.getElementById('errorQuickLink')?.addEventListener('click', e => { e.preventDefault(); runScan('quick'); });
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function clearError() {
      errorBox.classList.add('hidden');
      errorBox.innerHTML = '';
    }

    // ── Round 4: Enhanced user-friendly error messages ───────────────
    function userFriendlyError(err) {
      const msg = err?.message || String(err || 'Unknown error');
      const code = err?.code;
      // User rejected wallet transaction
      if (code === 4001 || msg.includes('User rejected') || msg.includes('user rejected')) {
        return ['Payment cancelled', 'You cancelled the transaction. You can try again or use Quick Scan (free).'];
      }
      // Wrong network
      if (msg.includes('chain') || msg.includes('network') || msg.includes('4902')) {
        return ['Wrong network', 'Please switch to Base Mainnet in your wallet and try again.'];
      }
      // Insufficient funds
      if (msg.includes('insufficient') || msg.includes('INSUFFICIENT')) {
        return ['Insufficient USDC balance', 'You need at least $1.00 USDC on Base to run a full scan. Try the free Quick Scan instead.'];
      }
      // Network / offline
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('net::ERR')) {
        return ['Network error — server may be offline', 'Check your internet connection and try again in a few seconds.'];
      }
      // Timeout
      if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('AbortError')) {
        return ['Request timed out', 'The analysis took too long. Try again or use Quick Scan (free) — it\'s faster.'];
      }
      // Rate limit
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many')) {
        return ['Rate limit reached', 'You\'ve sent too many requests. Wait 60 seconds and try again.'];
      }
      // Server error
      if (msg.includes('500') || msg.includes('503') || msg.includes('Internal') || msg.includes('Service Unavailable')) {
        return ['Server error', 'Something went wrong on our end. Usually temporary — try again in 30 seconds.'];
      }
      // Payment verification failed
      if (msg.includes('Payment verification') || msg.includes('pay-verify') || msg.includes('transaction')) {
        return ['Payment verification failed', 'Your payment went through but we couldn\'t verify it. Contact us with your transaction hash.'];
      }
      // No wallet
      if (msg.includes('No wallet') || msg.includes('window.ethereum') || msg.includes('MetaMask')) {
        return ['No wallet detected', 'Install MetaMask or Coinbase Wallet to pay $1 USDC. Or use the free Quick Scan.'];
      }
      // Project not found
      if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('no data')) {
        return ['Project not found', 'We couldn\'t find data for this project. Try a different name, ticker symbol, or contract address.'];
      }
      // Invalid input
      if (msg.includes('400') || msg.includes('Bad request') || msg.includes('invalid')) {
        return ['Invalid input', 'Check your project name or contract address and try again.'];
      }
      return [msg, null];
    }

    // ── DexScreener Autocomplete ──────────────────────────────────────
    let dexDebounceTimer = null;
    let dexActiveIndex = -1;
    let dexItems = [];

    function updateDexAriaState() {
      const isOpen = dexDropdown.classList.contains('open') && dexItems.length > 0;
      input.setAttribute('aria-expanded', String(isOpen));
      const activeId = dexActiveIndex >= 0 ? `dex-option-${dexActiveIndex}` : '';
      if (activeId) input.setAttribute('aria-activedescendant', activeId);
      else input.removeAttribute('aria-activedescendant');
    }

    function symbolColor(symbol) {
      let hash = 0;
      for (const c of symbol) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
      const hue = Math.abs(hash) % 360;
      return `hsl(${hue},55%,55%)`;
    }

    function renderDexItems(pairs) {
      if (!pairs || !pairs.length) {
        dexDropdown.innerHTML = '<div class="dex-empty">No tokens found</div>';
        dexDropdown.classList.add('open');
        dexItems = [];
        dexActiveIndex = -1;
        updateDexAriaState();
        return;
      }

      const bySymbol = new Map();
      for (const pair of pairs) {
        const sym = pair.baseToken?.symbol?.toUpperCase();
        if (!sym) continue;
        const liq = Number(pair.liquidity?.usd || 0);
        if (!bySymbol.has(sym) || liq > bySymbol.get(sym)._liq) {
          bySymbol.set(sym, { ...pair, _liq: liq });
        }
      }

      dexItems = Array.from(bySymbol.values()).slice(0, 8);
      dexActiveIndex = -1;

      dexDropdown.innerHTML = dexItems.map((pair, idx) => {
        const sym = escapeHtml(pair.baseToken?.symbol || '?');
        const name = escapeHtml(pair.baseToken?.name || '');
        const chain = escapeHtml(pair.chainId || '');
        const price = formatDexPrice(pair.priceUsd);
        const vol = formatDexVol(pair.volume?.h24);
        const imgUrl = pair.info?.imageUrl;
        const color = symbolColor(sym);

        const logo = imgUrl
          ? `<img class="dex-logo" src="${escapeHtml(imgUrl)}" alt="${sym}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : '';
        const fallback = `<div class="dex-logo-fallback" style="${imgUrl ? 'display:none' : ''};color:${color};border-color:${color}33">${sym.charAt(0)}</div>`;

        return `
          <div class="dex-item" id="dex-option-${idx}" role="option" aria-selected="false" data-index="${idx}" data-name="${escapeHtml(pair.baseToken?.name || sym)}">
            ${logo}${fallback}
            <div class="dex-info">
              <div class="dex-symbol">${sym}<span class="dex-chain">${chain}</span></div>
              <div class="dex-name">${name}</div>
            </div>
            <div class="dex-price">
              ${price ? `<div class="dex-price-val">${price}</div>` : ''}
              ${vol ? `<div class="dex-vol">${vol}</div>` : ''}
            </div>
          </div>`;
      }).join('');

      // Round 88: keyboard hint footer
      dexDropdown.insertAdjacentHTML('beforeend', `<div class="dex-keyboard-hint"><span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Select</span><span><kbd>Esc</kbd> Close</span></div>`);

      dexDropdown.classList.add('open');
      updateDexAriaState();

      dexDropdown.querySelectorAll('.dex-item').forEach((el) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = el.dataset.name;
          closeDexDropdown();
        });
      });
    }

    function closeDexDropdown() {
      dexDropdown.classList.remove('open');
      dexItems = [];
      dexActiveIndex = -1;
      updateDexAriaState();
    }

    function highlightDexItem(idx) {
      dexDropdown.querySelectorAll('.dex-item').forEach((el, i) => {
        const isActive = i === idx;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-selected', String(isActive));
        if (isActive) el.scrollIntoView({ block: 'nearest' });
      });
      updateDexAriaState();
    }

    async function fetchDexSuggestions(query) {
      if (!query || query.length < 2) { closeDexDropdown(); return; }
      try {
        dexDropdown.innerHTML = '<div class="dex-loading">Searching...</div>';
        dexDropdown.classList.add('open');
        dexActiveIndex = -1;
        updateDexAriaState();

        // Use our server proxy (handles CoinGecko + DexScreener fallback)
        var res = await fetch('/search?q=' + encodeURIComponent(query));
        if (!res.ok) { closeDexDropdown(); return; }
        var data = await res.json();

        if (data.coins && data.coins.length > 0) {
          renderCoinGeckoItems(data.coins);
        } else if (data.pairs && data.pairs.length > 0) {
          renderDexItems(data.pairs);
        } else {
          dexDropdown.innerHTML = '<div class="dex-empty">No tokens found</div>';
          dexDropdown.classList.add('open');
          dexItems = [];
          dexActiveIndex = -1;
          updateDexAriaState();
        }
      } catch (e) {
        closeDexDropdown();
      }
    }

    function renderCoinGeckoItems(coins) {
      if (!coins || !coins.length) {
        dexDropdown.innerHTML = '<div class="dex-empty">No tokens found</div>';
        dexDropdown.classList.add('open');
        dexItems = [];
        dexActiveIndex = -1;
        updateDexAriaState();
        return;
      }
      dexItems = coins;
      dexActiveIndex = -1;
      dexDropdown.innerHTML = coins.map((coin, idx) => {
        const sym = escapeHtml((coin.symbol || '?').toUpperCase());
        const name = escapeHtml(coin.name || '');
        const rank = coin.market_cap_rank ? `#${coin.market_cap_rank}` : '';
        const imgUrl = coin.thumb || coin.small;
        const color = symbolColor(sym);
        const logo = imgUrl
          ? `<img class="dex-logo" src="${escapeHtml(imgUrl)}" alt="${sym}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : '';
        const fallback = `<div class="dex-logo-fallback" style="${imgUrl ? 'display:none' : ''};color:${color};border-color:${color}33">${sym.charAt(0)}</div>`;

        return `
          <div class="dex-item" id="dex-option-${idx}" role="option" aria-selected="false" data-index="${idx}" data-name="${escapeHtml(coin.name || sym)}">
            ${logo}${fallback}
            <div class="dex-info">
              <div class="dex-symbol">${sym}${rank ? `<span class="dex-chain">${rank}</span>` : ''}</div>
              <div class="dex-name">${name}</div>
            </div>
          </div>`;
      }).join('');
      // Round 88: keyboard hint footer
      dexDropdown.insertAdjacentHTML('beforeend', `<div class="dex-keyboard-hint"><span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Select</span><span><kbd>Esc</kbd> Close</span></div>`);

      dexDropdown.classList.add('open');
      updateDexAriaState();
      dexDropdown.querySelectorAll('.dex-item').forEach((el) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = el.dataset.name;
          closeDexDropdown();
        });
      });
    }

    input.addEventListener('input', () => {
      const val = input.value.trim();
      clearTimeout(dexDebounceTimer);
      if (!val || val.length < 2) { closeDexDropdown(); return; }
      dexDebounceTimer = setTimeout(() => fetchDexSuggestions(val), 300);
    });

    input.addEventListener('keydown', e => {
      const isOpen = dexDropdown.classList.contains('open');
      const items = dexDropdown.querySelectorAll('.dex-item');
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isOpen && input.value.trim().length >= 2) {
        fetchDexSuggestions(input.value.trim());
        return;
      }
      if (!isOpen) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        dexActiveIndex = Math.min(dexActiveIndex + 1, items.length - 1);
        highlightDexItem(dexActiveIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        dexActiveIndex = Math.max(dexActiveIndex - 1, 0);
        highlightDexItem(dexActiveIndex);
      } else if (e.key === 'Enter' && dexActiveIndex >= 0) {
        e.preventDefault();
        const name = items[dexActiveIndex]?.dataset?.name;
        if (name) { input.value = name; closeDexDropdown(); }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeDexDropdown();
        input.focus();
      }
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.input-wrap')) closeDexDropdown();
    });

    input.addEventListener('focus', () => {
      const val = input.value.trim();
      if (val.length >= 2) fetchDexSuggestions(val);
    });

    // ── Payment flow (Base Mainnet USDC) ──────────────────────────────
    const BASE_CHAIN_ID  = '0x2105';
    const USDC_BASE      = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const PAY_TO         = '0x4bDE6B11Df6C0F0f5351e6fB0E7Bdc40eAa0cb4D';
    const PAYMENT_AMOUNT = '1000000'; // $1.00 USDC (6 decimals)

    async function switchToBase() {
      try {
        await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId:BASE_CHAIN_ID}] });
      } catch(e) {
        if (e.code === 4902) {
          await window.ethereum.request({ method:'wallet_addEthereumChain', params:[{
            chainId:BASE_CHAIN_ID, chainName:'Base',
            nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},
            rpcUrls:['https://mainnet.base.org'], blockExplorerUrls:['https://basescan.org']
          }]});
        } else throw e;
      }
    }

    async function sendUSDCPayment() {
      if (!window.ethereum) throw new Error('No wallet detected. Install MetaMask or Coinbase Wallet.');
      const accounts = await window.ethereum.request({method:'eth_requestAccounts'});
      const from = accounts[0];
      await switchToBase();
      const transferData = '0xa9059cbb' + PAY_TO.slice(2).padStart(64,'0') + BigInt(PAYMENT_AMOUNT).toString(16).padStart(64,'0');
      return await window.ethereum.request({ method:'eth_sendTransaction', params:[{from, to:USDC_BASE, data:transferData, value:'0x0'}] });
    }

    function removePaymentModal() {
      document.querySelector('.payment-overlay')?.remove();
    }

    function showPaymentModal(project, onSuccess) {
      removePaymentModal();
      const overlay = document.createElement('div');
      overlay.className = 'payment-overlay';
      overlay.setAttribute('role', 'presentation');
      overlay.addEventListener('click', (e) => { if (e.target === overlay) removePaymentModal(); });
      // Round 76: improved modal with step indicator + cleaner layout
      overlay.innerHTML = `
        <div class="payment-card" role="dialog" aria-modal="true" aria-labelledby="pay-title">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <div style="background:rgba(212,88,10,0.12);border:1px solid rgba(212,88,10,0.3);border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">🔍</div>
            <div>
              <div class="payment-title" id="pay-title" style="font-size:1.5rem;margin:0;">Full Alpha Scan</div>
              <div class="payment-sub" style="margin:2px 0 0;">One-time · No account · Instant</div>
            </div>
          </div>
          <!-- Step indicator -->
          <div style="display:flex;align-items:center;gap:0;margin:16px 0 14px;font-size:0.73rem;color:var(--muted);">
            <div id="pay-step-1" style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:rgba(212,88,10,0.15);color:#D4580A;font-weight:600;white-space:nowrap;">① Connect</div>
            <div style="flex:1;height:1px;background:var(--border);margin:0 6px;"></div>
            <div id="pay-step-2" style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:transparent;color:var(--muted);font-weight:500;white-space:nowrap;">② Confirm tx</div>
            <div style="flex:1;height:1px;background:var(--border);margin:0 6px;"></div>
            <div id="pay-step-3" style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:transparent;color:var(--muted);font-weight:500;white-space:nowrap;">③ Analysis</div>
          </div>
          <!-- What you pay for -->
          <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="color:var(--muted);font-size:0.82rem;">Project</span>
              <span style="color:var(--text);font-weight:600;font-size:0.92rem;">${escapeHtml(project)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="color:var(--muted);font-size:0.82rem;">Network</span>
              <span class="network-badge">Base Mainnet</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border);padding-top:8px;margin-top:8px;">
              <span style="color:var(--muted);font-size:0.82rem;">Total</span>
              <span style="color:#D4580A;font-weight:800;font-size:1.1rem;font-family:'IBM Plex Mono',monospace;">$1.00 USDC</span>
            </div>
          </div>
          <!-- Included -->
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">
            ${['✓ 10 data sources','✓ Claude Opus 4.6','✓ Grok Fast X Search','✓ BUY/HOLD/AVOID'].map(f=>`<span style="font-size:0.72rem;padding:3px 9px;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.15);border-radius:999px;color:#86efac;">${escapeHtml(f)}</span>`).join('')}
          </div>
          <div class="payment-error" id="payError" style="display:none;"></div>
          <button class="pay-btn" id="payBtn">Connect Wallet &amp; Pay $1.00 USDC</button>
          <button class="pay-cancel" id="payCancelBtn">Cancel — use free quick scan instead</button>
        </div>`;
      document.body.appendChild(overlay);

      document.getElementById('payCancelBtn').onclick = () => removePaymentModal();

      const focusable = overlay.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
      const firstFocus = focusable[0];
      const lastFocus  = focusable[focusable.length - 1];
      firstFocus?.focus();
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Tab') {
          if (e.shiftKey) { if (document.activeElement === firstFocus) { e.preventDefault(); lastFocus?.focus(); } }
          else            { if (document.activeElement === lastFocus)  { e.preventDefault(); firstFocus?.focus(); } }
        }
        if (e.key === 'Escape') removePaymentModal();
      });

      // Round 76: step indicator helper
      function setPayStep(n) {
        [1,2,3].forEach(i => {
          const el = document.getElementById(`pay-step-${i}`);
          if (!el) return;
          if (i === n) { el.style.background='rgba(212,88,10,0.15)'; el.style.color='#D4580A'; el.style.fontWeight='600'; }
          else if (i < n) { el.style.background='rgba(34,197,94,0.1)'; el.style.color='#86efac'; el.style.fontWeight='500'; }
          else { el.style.background='transparent'; el.style.color='var(--muted)'; el.style.fontWeight='500'; }
        });
      }

      document.getElementById('payBtn').onclick = async () => {
        const btn = document.getElementById('payBtn');
        const errEl = document.getElementById('payError');
        errEl.style.display = 'none';
        btn.textContent = 'Connecting wallet...';
        btn.disabled = true;
        setPayStep(1);
        try {
          btn.textContent = 'Confirm in wallet...';
          setPayStep(2);
          const txHash = await sendUSDCPayment();
          if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
            throw new Error('Invalid transaction hash received from wallet.');
          }
          btn.textContent = 'Analyzing...';
          setPayStep(3);
          await new Promise(r => setTimeout(r, 5000));
          const safeProject = String(project).slice(0, 100);
          const response = await fetch('/alpha/pay-verify', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ txHash, project: safeProject })
          });
          if (!response.ok) { const e = await response.json(); throw new Error(e.error||'Payment verification failed'); }
          const result = await response.json();
          removePaymentModal();
          onSuccess(result);
        } catch(e) {
          btn.textContent = 'Connect Wallet & Pay $1.00';
          btn.disabled = false;
          errEl.textContent = e.code === 4001 ? 'Transaction cancelled.' : (e.message || 'Payment failed');
          errEl.style.display = 'block';
        }
      };
    }

    // ── Persist API key from URL (survives replaceState) ─────────────
    const _persistedKey = new URLSearchParams(location.search).get('key') || '';
    // If key present, relabel Full Scan button (no payment needed)
    if (_persistedKey) {
      const scanBtn = document.getElementById('scan-btn');
      if (scanBtn) { scanBtn.textContent = 'Full Scan'; }
    }

    // ── Main scan function ────────────────────────────────────────────
    async function runScan(mode = 'full') {
      clearError();
      reportBox.classList.add('hidden');
      closeDexDropdown();
      const project = input.value.trim();
      if (!project) {
        showError('Enter a project name or contract address.', 'Example: solana, aave, uniswap, or paste a 0x… address');
        return;
      }
      if (project.length > 100) {
        showError('Project name too long', 'Please enter a shorter name or a valid contract address.');
        return;
      }

      if (mode === 'quick') {
        setLoading(true, mode);
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          let res;
          try {
            res = await fetch(`/alpha/quick?project=${encodeURIComponent(project)}&force_refresh=true`, { signal: controller.signal });
          } finally {
            clearTimeout(timeoutId);
          }
          const payload = await res.json();
          if (!res.ok) throw new Error(payload?.error || `Server error (${res.status})`);
          renderReport(payload);
          history.replaceState({}, '', `${location.pathname}?project=${encodeURIComponent(project)}&mode=quick${_persistedKey ? '&key=' + encodeURIComponent(_persistedKey) : ''}`);
        } catch(err) {
          const [msg, hint] = err.name === 'AbortError'
            ? ['Request timed out', 'The quick scan took too long. Try again.']
            : userFriendlyError(err);
          showError(msg, hint);
        } finally {
          setLoading(false, mode);
        }
      } else {
        // Bypass payment if API key is in URL (persisted across replaceState)
        var urlKey = _persistedKey || new URLSearchParams(location.search).get('key');
        if (urlKey) {
          setLoading(true, mode);
          try {
            var controller2 = new AbortController();
            var tid2 = setTimeout(function() { controller2.abort(); }, 90000);
            var res2;
            try {
              res2 = await fetch('/alpha?project=' + encodeURIComponent(project) + '&key=' + encodeURIComponent(urlKey) + '&force_refresh=true', { signal: controller2.signal });
            } finally { clearTimeout(tid2); }
            var payload2 = await res2.json();
            if (!res2.ok) throw new Error(payload2?.error || 'Server error (' + res2.status + ')');
            renderReport(payload2);
          } catch(err2) {
            var pair2 = err2.name === 'AbortError' ? ['Request timed out', 'Full scan took too long.'] : userFriendlyError(err2);
            showError(pair2[0], pair2[1]);
          } finally { setLoading(false, mode); }
        } else {
          showPaymentModal(project, (result) => {
            renderReport(result);
            history.replaceState({}, '', location.pathname + '?project=' + encodeURIComponent(project) + '&mode=full' + (_persistedKey ? '&key=' + encodeURIComponent(_persistedKey) : ''));
          });
        }
      }
    }

    form.addEventListener('submit', e => { e.preventDefault(); runScan('full'); });
    quickLink.addEventListener('click', e => { e.preventDefault(); runScan('quick'); });

    // Auto-run from URL params
    const params = new URLSearchParams(location.search);
    const initProject = params.get('project');
    if (initProject) {
      input.value = initProject;
      runScan(params.get('mode') === 'quick' ? 'quick' : 'full');
    }
  
    // ── Round 5: Consolidated IntersectionObserver (removed duplicate) ──
    const fadeObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            // Unobserve after reveal to save memory
            fadeObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.10, rootMargin: '0px 0px -30px 0px' }
    );
    document.querySelectorAll('.scanner-fade-in, .fade-in:not(.visible)').forEach(el => fadeObserver.observe(el));

    // ── Live stats: fetch /api/health ────────────────────────────────
    (async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) return;
        const data = await res.json();
        const count = data?.stats?.total_scans ?? data?.total_scans ?? data?.scans ?? null;
        if (count !== null && count !== undefined) {
          const el = document.getElementById('stat-projects-scan');
          if (el) el.textContent = Number(count).toLocaleString();
        }
      } catch (_) {
        // silently fail — stat is decorative
      }
    })();

