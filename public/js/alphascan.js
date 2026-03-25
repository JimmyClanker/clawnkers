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
      reportBox.innerHTML = `
        <div class="skeleton-panel">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
            <div style="display:grid;gap:10px;flex:1;">
              <div class="skeleton skeleton-line w-40" style="height:12px;"></div>
              <div class="skeleton skeleton-title"></div>
            </div>
            <div class="skeleton skeleton-badge"></div>
          </div>
          <div class="skeleton skeleton-line w-full"></div>
          <div class="skeleton skeleton-line w-80"></div>
          <div class="skeleton skeleton-line w-60"></div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:4px;">
            <div class="skeleton" style="height:80px;border-radius:12px;"></div>
            <div class="skeleton" style="height:80px;border-radius:12px;"></div>
            <div class="skeleton" style="height:80px;border-radius:12px;"></div>
          </div>
        </div>
        <div class="skeleton-panel" style="display:grid;gap:10px;">
          <div class="skeleton skeleton-line w-40" style="height:12px;"></div>
          ${[0,1,2,3,4].map(i => `<div class="skeleton-score">
            <div class="skeleton skeleton-line w-full"></div>
            <div class="skeleton skeleton-bar"></div>
            <div class="skeleton skeleton-line w-40"></div>
          </div>`).join('')}
        </div>`;
    }

    // ── Loading state ────────────────────────────────────────────────
    function setLoading(isLoading, mode) {
      const scanBtn   = document.getElementById('scan-btn');
      const quickLinkEl = document.getElementById('quick-link');

      if (isLoading) {
        if (scanBtn)    { scanBtn.disabled = true; scanBtn.textContent = 'Scanning…'; scanBtn.setAttribute('aria-busy', 'true'); }
        if (quickLinkEl) quickLinkEl.style.pointerEvents = 'none';

        const project   = escapeHtml(input.value.trim() || 'project');
        const modeLabel = mode === 'quick'
          ? 'Free quick scan — algorithmic scoring'
          : 'Full deep scan — 5 sources + Grok 4.20 MultiAgent · ~10–20s';

        statusBox.innerHTML = `
          <div class="loading-wrap" role="status" aria-live="polite" aria-label="Scanning ${project}">
            <div class="chalk-loading">Scanning <span class="loading-project">${project}</span><span class="loading-dots"></span></div>
            <div class="loading-bar" aria-hidden="true"></div>
            <div class="footnote">${modeLabel}</div>
          </div>`;
        // Show skeleton while loading
        showSkeleton();
      } else {
        if (scanBtn)    { scanBtn.disabled = false; scanBtn.textContent = 'Full Scan $1'; scanBtn.removeAttribute('aria-busy'); }
        if (quickLinkEl) quickLinkEl.style.pointerEvents = '';
        statusBox.innerHTML = '';
      }
    }

    // ── Radar chart ─────────────────────────────────────────────────
    function renderRadar(scores) {
      const size = 400, center = size/2, radius = 108, levels = 5;
      const keys = SCORE_META.map(([k])=>k), labels = SCORE_META.map(([,l])=>l);
      const values = keys.map(k=>Number(scores?.[k]?.score||0));
      const points = values.map((v,i)=>{
        const angle = (-Math.PI/2)+(i*Math.PI*2/values.length);
        const scale = Math.max(0,Math.min(10,v))/10;
        return [center+Math.cos(angle)*radius*scale, center+Math.sin(angle)*radius*scale];
      });
      const polygon = points.map(([x,y])=>`${x},${y}`).join(' ');
      const grid = Array.from({length:levels},(_,i)=>{
        const l=i+1, lr=radius*(l/levels);
        const lp=labels.map((_,j)=>{
          const a=(-Math.PI/2)+(j*Math.PI*2/labels.length);
          return `${center+Math.cos(a)*lr},${center+Math.sin(a)*lr}`;
        }).join(' ');
        const ty=center-lr+4;
        return `<polygon points="${lp}" fill="none" stroke="rgba(232,232,232,${0.08+l*0.02})" stroke-dasharray="4 6" /><text x="${center+10}" y="${ty}" fill="rgba(232,232,232,0.36)" font-size="10">${l*2}</text>`;
      }).join('');
      const axes = labels.map((label,i)=>{
        const a=(-Math.PI/2)+(i*Math.PI*2/labels.length);
        const x=center+Math.cos(a)*radius, y=center+Math.sin(a)*radius;
        const tx=center+Math.cos(a)*(radius+42), ty=center+Math.sin(a)*(radius+42);
        const anchor=Math.cos(a)>0.25?'start':Math.cos(a)<-0.25?'end':'middle';
        return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="rgba(232,232,232,0.16)" /><circle cx="${x}" cy="${y}" r="2.5" fill="rgba(232,232,232,0.35)" /><text x="${tx}" y="${ty}" fill="#e8e8e8" font-size="12.5" text-anchor="${anchor}" dominant-baseline="middle">${label}</text>`;
      }).join('');
      return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Radar chart"><defs><filter id="radar-glow"><feGaussianBlur stdDeviation="3" result="blur"></feGaussianBlur><feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter></defs>${grid}${axes}<circle cx="${center}" cy="${center}" r="3" fill="rgba(255,255,255,0.35)" /><polygon points="${polygon}" fill="rgba(212,88,10,0.16)" stroke="#D4580A" stroke-width="2.5" filter="url(#radar-glow)" />${points.map(([x,y],i)=>`<g><circle cx="${x}" cy="${y}" r="6" fill="rgba(10,10,10,0.9)" stroke="${SCORE_META[i][2]}" stroke-width="2" /><circle cx="${x}" cy="${y}" r="2.5" fill="${SCORE_META[i][2]}" /></g>`).join('')}</svg>`;
    }


    function renderScoreBars(scores) {
      return SCORE_META.map(([key,label])=>{
        const v=Number(scores?.[key]?.score||0), w=`${Math.max(0,Math.min(100,v*10))}%`;
        const tone=v>=8?'High conviction':v>=6?'Constructive':v>=4?'Mixed setup':'Fragile';
        return `<div class="score-row"><div class="score-label"><strong>${label}</strong><span>${tone}</span></div><div class="bar"><span style="--target-width:${w}; background:${barColor(v)}"></span></div><div class="score-value">${v.toFixed(1)}/10</div></div>`;
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

      if (!summary && !category) return '';

      return `<div class="project-intro-panel" style="margin:18px 0;">
        <div class="project-intro-card">
          <div class="project-intro-title">📋 What is ${escapeHtml(projectName)}?</div>
          ${summary ? `<div class="project-intro-text">${formatAnalysisText(summary)}</div>` : ''}
          ${category ? `<div class="project-intro-meta">Category: <span class="project-category-badge">${escapeHtml(category)}</span></div>` : ''}
        </div>
      </div>`;
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

      reportBox.innerHTML = `
        <div class="grid">
          <section class="panel">
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
            <div class="mini-grid">
              <div class="card moat"><h3>🛡 Moat</h3><div>${escapeHtml(analysis.moat||'n/a')}</div></div>
              <div class="card risks"><h3>⚠ Risks</h3><ul>${renderList(analysis.risks)}</ul></div>
              <div class="card catalysts"><h3>🚀 Catalysts</h3><ul>${renderList(analysis.catalysts)}</ul></div>
            </div>
          </section>
          <section class="panel radar-panel">
            <div class="section-label">Score Radar</div>
            ${renderRadar(scores)}
            <div class="score-list">${renderScoreBars(scores)}</div>
          </section>
        </div>

        ${(()=>{const mr=metricRows(raw);const gc=renderGithubCard(raw?.github);return(mr||gc)?`<section class="panel" style="margin-top:18px;">
          <div class="section-label">Market Board</div>
          ${mr?`<table class="table"><tbody>${mr}</tbody></table>`:''}
          ${gc}
        </section>`:''})()}

        ${analysis.x_sentiment_summary&&analysis.x_sentiment_summary!=='n/a'?`<section class="panel" style="margin-top:18px;">
          <div class="section-label" style="display:flex;align-items:center;gap:8px;">X Sentiment${(()=>{const nm=payload?.raw_data?.social?.news_momentum;const vc=payload?.raw_data?.social?.very_recent_news_count;if(!nm||nm==='no_data')return'';const col=nm==='accelerating'?'#22c55e':nm==='declining'?'#f87171':'#fbbf24';return`<span style="font-size:0.72rem;padding:2px 8px;border-radius:999px;background:${col}22;color:${col};font-weight:600;">${nm==='accelerating'?'📈':nm==='declining'?'📉':'➡️'} ${nm}${vc?` (${vc} recent)`:''}`;})()}</div>
          <div class="analysis">${formatAnalysisText(analysis.x_sentiment_summary)}</div>
        </section>`:''}

        ${analysis.competitor_comparison&&analysis.competitor_comparison!=='n/a'?`<section class="panel" style="margin-top:18px;">
          <div class="section-label">Competitor Comparison</div>
          <div class="analysis">${formatAnalysisText(analysis.competitor_comparison)}</div>
        </section>`:''}

        ${analysis.key_findings&&analysis.key_findings.length?`<section class="panel" style="margin-top:18px;">
          <div class="section-label">Key Findings</div>
          <ul>${renderList(analysis.key_findings)}</ul>
        </section>`:''}

        ${(()=>{const t=payload?.thesis;if(!t)return'';return`<section class="panel" style="margin-top:18px;">
          <div class="section-label" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">Investment Thesis${t.metrics_snapshot?`<span style="font-size:0.72rem;color:#94a3b8;font-weight:400;">${escapeHtml(t.metrics_snapshot)}</span>`:''}${t.one_liner?`<span style="font-size:0.75rem;padding:2px 10px;background:rgba(212,88,10,0.12);border:1px solid rgba(212,88,10,0.3);border-radius:999px;color:#ffd3b6;margin-left:auto;">${escapeHtml(t.one_liner)}</span>`:''}</div>
          <div class="mini-grid">
            <div class="card" style="border-color:rgba(34,197,94,0.3)"><h3>🐂 Bull Case</h3><div>${escapeHtml(t.bull_case||'n/a')}</div></div>
            <div class="card" style="border-color:rgba(239,68,68,0.3)"><h3>🐻 Bear Case</h3><div>${escapeHtml(t.bear_case||'n/a')}</div></div>
            <div class="card" style="border-color:rgba(251,191,36,0.3)"><h3>🔄 Neutral</h3><div>${escapeHtml(t.neutral_case||'n/a')}</div></div>
          </div>
        </section>`;})()}

        ${(()=>{const rf=payload?.red_flags;if(!rf||!rf.length)return'';const crit=rf.filter(f=>f.severity==='critical');const warn=rf.filter(f=>f.severity==='warning');if(!crit.length&&!warn.length)return'';return`<section class="panel" style="margin-top:18px;">
          <div class="section-label">⚠ Risk Flags (${rf.length})</div>
          ${crit.length?`<div style="margin-bottom:8px;font-size:0.78rem;color:#ef4444;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Critical (${crit.length})</div><ul>${crit.map(f=>`<li style="color:#fca5a5;margin-bottom:4px;"><strong>${escapeHtml(humanizeLabel(f.flag))}</strong>: ${escapeHtml(f.detail)}</li>`).join('')}</ul>`:''}
          ${warn.length?`<div style="margin:8px 0 6px;font-size:0.78rem;color:#f97316;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Warnings (${warn.length})</div><ul>${warn.map(f=>`<li style="color:#fdba74;margin-bottom:4px;"><strong>${escapeHtml(humanizeLabel(f.flag))}</strong>: ${escapeHtml(f.detail)}</li>`).join('')}</ul>`:''}
        </section>`;})()}

        ${(()=>{const as_=payload?.alpha_signals;if(!as_||!as_.length)return'';return`<section class="panel" style="margin-top:18px;">
          <div class="section-label">🚀 Alpha Signals (${as_.length})</div>
          <ul>${as_.map(s=>`<li style="margin-bottom:6px;"><span style="background:rgba(34,197,94,0.15);padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:700;color:#86efac;margin-right:8px;">${escapeHtml(s.strength||'?')}</span><strong>${escapeHtml(humanizeLabel(s.signal))}</strong>: ${escapeHtml(s.detail)}</li>`).join('')}</ul>
        </section>`;})()}

        ${(()=>{const ts=payload?.trade_setup;const rr=payload?.risk_reward;if(!ts||!ts.entry_zone?.low)return'';const qualColor={strong:'#22c55e',moderate:'#fbbf24',weak:'#ef4444'}[ts.setup_quality]||'#e8e8e8';return`<section class="panel" style="margin-top:18px;">
          <div class="section-label">📐 Trade Setup</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
            <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:10px 16px;min-width:110px;text-align:center;"><div style="color:#7e7e7e;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px;">Entry Zone</div><div style="font-weight:700;">$${escapeHtml(String(ts.entry_zone.low))} – $${escapeHtml(String(ts.entry_zone.high))}</div></div>
            <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:10px 16px;min-width:110px;text-align:center;"><div style="color:#7e7e7e;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px;">Stop Loss</div><div style="font-weight:700;color:#ef4444;">$${escapeHtml(String(ts.stop_loss??'n/a'))}</div></div>
            ${(ts.take_profit_targets||[]).slice(0,2).map(tp=>`<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:10px 16px;min-width:110px;text-align:center;"><div style="color:#7e7e7e;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px;">${escapeHtml(tp.label)}</div><div style="font-weight:700;color:#86efac;">$${escapeHtml(String(tp.price))} <span style="font-size:11px;color:#7e7e7e;">(+${escapeHtml(String(tp.pct_gain))}%)</span></div></div>`).join('')}
            ${ts.risk_reward_ratio!=null?`<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:10px 16px;min-width:110px;text-align:center;"><div style="color:#7e7e7e;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px;">R/R Ratio</div><div style="font-weight:700;">${escapeHtml(String(ts.risk_reward_ratio))}x</div></div>`:''}
            <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:10px 16px;min-width:110px;text-align:center;"><div style="color:#7e7e7e;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px;">Setup Quality</div><div style="font-weight:700;color:${qualColor};">${escapeHtml(ts.setup_quality||'?')}</div></div>
            ${rr?.position_size_suggestion?`<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:10px 16px;min-width:110px;text-align:center;"><div style="color:#7e7e7e;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px;">Position Size</div><div style="font-weight:700;color:#fbbf24;">${escapeHtml(rr.position_size_suggestion)}</div></div>`:''}
          </div>
          ${rr?.expected_value!=null?`<div style="font-size:0.82rem;color:#7e7e7e;">Kelly: ${rr.kelly_fraction!=null?(rr.kelly_fraction*100).toFixed(1)+'%':'n/a'} · EV: <span style="color:${rr.expected_value>0?'#86efac':rr.expected_value<0?'#f87171':'#7e7e7e'}">${escapeHtml(String(rr.expected_value))}</span>${rr.vol_adjusted_ev!=null&&rr.vol_adjusted_ev!==rr.expected_value?` · vol-adj EV: <span style="color:${rr.vol_adjusted_ev>0?'#86efac':'#f87171'}">${escapeHtml(String(rr.vol_adjusted_ev))}</span>`:''}${rr.ev_label?` <span style="font-size:0.75rem;color:#94a3b8;">(${escapeHtml(rr.ev_label)})</span>`:''} · TP1 prob: ${rr.probability_tp1!=null?(rr.probability_tp1*100).toFixed(0)+'%':'n/a'}</div>`:''}
        </section>`;})()}

        ${(()=>{
          const dg = analysis?.data_gaps || payload?.data_gaps || [];
          const vw = payload?._validation?.warnings || [];
          const ds = payload?._validation?.data_sources_available || [];
          const rq = payload?.report_quality;
          if (!dg.length && !vw.length && !rq) return '';
          return `<section class="panel" style="margin-top:18px;border-color:rgba(251,191,36,0.2);">
            <div class="section-label">📋 Data Reliability</div>
            ${rq ? `<div style="margin-bottom:8px;font-size:0.85rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">Report quality: <strong style="color:${rq.grade==='A'?'#22c55e':rq.grade==='B'?'#86efac':rq.grade==='C'?'#fbbf24':rq.grade==='D'?'#f97316':'#ef4444'}">${escapeHtml(rq.grade)}</strong> (${rq.quality_score ?? rq.score}/100)${rq.verdict_confidence ? `<span style="font-size:0.75rem;padding:2px 8px;border-radius:999px;background:${rq.verdict_confidence==='high'?'rgba(34,197,94,0.15)':rq.verdict_confidence==='medium'?'rgba(251,191,36,0.15)':'rgba(248,113,113,0.15)'};color:${rq.verdict_confidence==='high'?'#22c55e':rq.verdict_confidence==='medium'?'#fbbf24':'#f87171'}">verdict confidence: ${escapeHtml(rq.verdict_confidence)}</span>` : ''}${rq.dimension_coverage_pct != null ? `<span style="font-size:0.75rem;color:#94a3b8;">${rq.dimension_coverage_pct}% dim coverage</span>` : ''}</div>` : ''}
            ${ds.length ? `<div style="font-size:0.78rem;color:#86efac;margin-bottom:4px;">✅ Data sources: ${ds.map(s=>escapeHtml(s)).join(', ')}</div>` : ''}
            ${dg.length ? `<div style="font-size:0.78rem;color:#fbbf24;margin-bottom:4px;">⚠ Data gaps: ${dg.map(g=>escapeHtml(g)).join(', ')}</div>` : ''}
            ${vw.length ? `<div style="font-size:0.78rem;color:#f97316;margin-top:4px;">🔍 Validation notes: ${vw.map(w=>escapeHtml(w)).join('; ')}</div>` : ''}
          </section>`;
        })()}

        <section class="panel" style="margin-top:18px;">
          <div class="footer-row">
            <div class="footnote">Generated: ${escapeHtml(payload?.generated_at||'n/a')}</div>
            <div class="footnote">Cache: ${cache.hit?'HIT':'MISS'} · age ${escapeHtml(formatDuration(cache.age_ms))} · ttl ${escapeHtml(formatDuration(cache.ttl_ms))}</div>
          </div>
          <div class="footnote" style="margin-top:8px;">Powered by Grok 4.20 MultiAgent + CoinGecko + DeFiLlama</div>
        </section>
      `;

      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      overlay.innerHTML = `
        <div class="payment-card" role="dialog" aria-modal="true" aria-labelledby="pay-title">
          <div class="payment-title" id="pay-title">🔒 Full Scan</div>
          <div class="payment-sub">One-time payment · No account required · Instant analysis</div>
          <div class="payment-row"><span>Project</span><span style="color:var(--text);font-weight:600;">${escapeHtml(project)}</span></div>
          <div class="payment-row"><span>Price</span><span style="color:#D4580A;font-weight:700;">$1.00 USDC</span></div>
          <div class="payment-row"><span>Network</span><span><span class="network-badge">Base Mainnet</span></span></div>
          <div class="payment-row"><span>What you get</span><span style="font-size:0.8rem;">5 sources · Grok 4.20 MultiAgent · BUY/HOLD/AVOID</span></div>
          <div class="payment-error" id="payError" style="display:none;"></div>
          <button class="pay-btn" id="payBtn">Connect Wallet &amp; Pay $1.00</button>
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

      document.getElementById('payBtn').onclick = async () => {
        const btn = document.getElementById('payBtn');
        const errEl = document.getElementById('payError');
        errEl.style.display = 'none';
        btn.textContent = 'Connecting wallet...';
        btn.disabled = true;
        try {
          btn.textContent = 'Confirm in wallet...';
          const txHash = await sendUSDCPayment();
          if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
            throw new Error('Invalid transaction hash received from wallet.');
          }
          btn.textContent = 'Verifying payment...';
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
            res = await fetch(`/alpha/quick?project=${encodeURIComponent(project)}`, { signal: controller.signal });
          } finally {
            clearTimeout(timeoutId);
          }
          const payload = await res.json();
          if (!res.ok) throw new Error(payload?.error || `Server error (${res.status})`);
          renderReport(payload);
          history.replaceState({}, '', `/?project=${encodeURIComponent(project)}&mode=quick`);
        } catch(err) {
          const [msg, hint] = err.name === 'AbortError'
            ? ['Request timed out', 'The quick scan took too long. Try again.']
            : userFriendlyError(err);
          showError(msg, hint);
        } finally {
          setLoading(false, mode);
        }
      } else {
        // Bypass payment if API key is in URL
        var urlKey = new URLSearchParams(location.search).get('key');
        if (urlKey) {
          setLoading(true, mode);
          try {
            var controller2 = new AbortController();
            var tid2 = setTimeout(function() { controller2.abort(); }, 90000);
            var res2;
            try {
              res2 = await fetch('/alpha?project=' + encodeURIComponent(project) + '&key=' + encodeURIComponent(urlKey), { signal: controller2.signal });
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
            history.replaceState({}, '', '/?project=' + encodeURIComponent(project) + '&mode=full');
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

