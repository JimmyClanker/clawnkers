import { safeNum } from '../utils/math.js';
/**
 * competitor-detection.js — Round 28
 * Auto-detects competitors using DeFiLlama protocols endpoint.
 */

const DEFILLAMA_PROTOCOLS_URL = 'https://api.llama.fi/protocols';
const FETCH_TIMEOUT_MS = 8000;

// Round 16 (AutoResearch nightly): In-memory cache for protocols list (avoids repeated 10MB fetch per scan)
let _protocolsCache = null;
let _protocolsCacheAt = 0;
const PROTOCOLS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes


function normalizeCategory(cat) {
  if (!cat) return null;
  return String(cat).trim().toLowerCase();
}

function fmtTvl(tvl) {
  const n = safeNum(tvl, 0);
  if (n === 0) return 'n/a';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

async function fetchProtocols() {
  // Round 16: serve from cache if fresh
  if (_protocolsCache && Date.now() - _protocolsCacheAt < PROTOCOLS_CACHE_TTL_MS) {
    return _protocolsCache;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(DEFILLAMA_PROTOCOLS_URL, { signal: controller.signal });
    if (!resp.ok) throw new Error(`DeFiLlama returned ${resp.status}`);
    const data = await resp.json();
    _protocolsCache = data;
    _protocolsCacheAt = Date.now();
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Detect top competitors in the same DeFiLlama category.
 *
 * @param {string} projectName
 * @param {object} rawData - raw collector output
 * @returns {Promise<{ competitors: Array<{ name, tvl, category, chains }>, comparison_summary: string }>}
 */
export async function detectCompetitors(projectName, rawData) {
  const category = normalizeCategory(
    rawData?.onchain?.category ?? rawData?.market?.category
  );

  if (!category) {
    return {
      competitors: [],
      comparison_summary: 'No category data available — competitor detection skipped.',
    };
  }

  let protocols;
  try {
    protocols = await fetchProtocols();
  } catch (err) {
    return {
      competitors: [],
      comparison_summary: `DeFiLlama fetch failed: ${err.message}`,
    };
  }

  const nameNorm = projectName.trim().toLowerCase();

  // Find the project itself for context — use fuzzy matching (name, symbol, slug)
  const projectEntry = protocols.find((p) => {
    const pName = String(p.name ?? '').toLowerCase();
    const pSlug = String(p.slug ?? '').toLowerCase();
    const pSym = String(p.symbol ?? '').toLowerCase();
    return pName === nameNorm || pSlug === nameNorm || pSym === nameNorm;
  });
  const projectTvl = safeNum(projectEntry?.tvl, rawData?.onchain?.tvl ?? 0);
  const projectSlug = projectEntry?.slug ?? null;

  // Round 29: exclude the project itself by name AND slug
  const projectSlugNorm = projectSlug ? projectSlug.toLowerCase() : null;

  // Filter to same category, exclude project itself, sort by TVL desc
  const peers = protocols
    .filter((p) => {
      const pCat = normalizeCategory(p.category);
      const pName = String(p.name ?? '').toLowerCase();
      const pSlug = String(p.slug ?? '').toLowerCase();
      if (pCat !== category) return false;
      if (pName === nameNorm) return false;
      if (projectSlugNorm && pSlug === projectSlugNorm) return false;
      return true;
    })
    .sort((a, b) => safeNum(b.tvl) - safeNum(a.tvl))
    .slice(0, 3)
    .map((p) => ({
      name: p.name,
      slug: p.slug ?? null,
      tvl: safeNum(p.tvl, 0),
      tvl_fmt: fmtTvl(p.tvl),
      category: p.category,
      chains: Array.isArray(p.chains) ? p.chains.slice(0, 5) : [],
      // Round 29: include mcap if available for richer comparison
      mcap: safeNum(p.mcap, 0) || null,
    }));

  let comparison_summary;
  if (peers.length === 0) {
    comparison_summary = `No peers found in category "${category}" on DeFiLlama.`;
  } else {
    const peerLines = peers.map(
      (p) => `${p.name} (TVL: ${p.tvl_fmt}${p.mcap ? `, MCap: ${fmtTvl(p.mcap)}` : ''}, chains: ${p.chains.join(', ') || 'n/a'})`
    );
    const rank = peers.filter((p) => p.tvl > projectTvl).length + 1;
    const projectMcap = safeNum(rawData?.market?.market_cap, projectEntry?.mcap ?? 0);
    const ptvl = projectTvl > 0 && projectMcap > 0 ? (projectMcap / projectTvl).toFixed(2) : null;
    // Round 69: Add sector TVL dominance percentage
    const sectorTotalTvl = peers.reduce((s, p) => s + p.tvl, 0) + projectTvl;
    const dominancePct = sectorTotalTvl > 0 ? ((projectTvl / sectorTotalTvl) * 100).toFixed(1) : null;
    comparison_summary = `In the "${category}" category, ${projectName} (TVL: ${fmtTvl(projectTvl)}${projectMcap > 0 ? `, MCap: ${fmtTvl(projectMcap)}` : ''}${ptvl ? `, P/TVL: ${ptvl}x` : ''}${dominancePct ? `, ${dominancePct}% sector TVL share` : ''}) ranks ~#${rank} among peers. Top competitors: ${peerLines.join('; ')}.`;
  }

  return { competitors: peers, comparison_summary };
}
