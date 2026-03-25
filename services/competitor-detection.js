/**
 * competitor-detection.js — Round 28
 * Auto-detects competitors using DeFiLlama protocols endpoint.
 */

const DEFILLAMA_PROTOCOLS_URL = 'https://api.llama.fi/protocols';
const FETCH_TIMEOUT_MS = 8000;

function safeN(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function normalizeCategory(cat) {
  if (!cat) return null;
  return String(cat).trim().toLowerCase();
}

function fmtTvl(tvl) {
  const n = safeN(tvl, 0);
  if (n === 0) return 'n/a';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

async function fetchProtocols() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(DEFILLAMA_PROTOCOLS_URL, { signal: controller.signal });
    if (!resp.ok) throw new Error(`DeFiLlama returned ${resp.status}`);
    return await resp.json();
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

  // Filter to same category, exclude project itself, sort by TVL desc
  const peers = protocols
    .filter((p) => {
      const pCat = normalizeCategory(p.category);
      const pName = String(p.name ?? '').toLowerCase();
      return pCat === category && pName !== nameNorm;
    })
    .sort((a, b) => safeN(b.tvl) - safeN(a.tvl))
    .slice(0, 3)
    .map((p) => ({
      name: p.name,
      tvl: safeN(p.tvl, 0),
      tvl_fmt: fmtTvl(p.tvl),
      category: p.category,
      chains: Array.isArray(p.chains) ? p.chains.slice(0, 5) : [],
    }));

  // Find the project itself for context
  const projectEntry = protocols.find(
    (p) => String(p.name ?? '').toLowerCase() === nameNorm
  );
  const projectTvl = safeN(projectEntry?.tvl, rawData?.onchain?.tvl ?? 0);

  let comparison_summary;
  if (peers.length === 0) {
    comparison_summary = `No peers found in category "${category}" on DeFiLlama.`;
  } else {
    const peerLines = peers.map(
      (p) => `${p.name} (TVL: ${p.tvl_fmt}, chains: ${p.chains.join(', ') || 'n/a'})`
    );
    const rank = peers.filter((p) => p.tvl > projectTvl).length + 1;
    comparison_summary = `In the "${category}" category, ${projectName} (TVL: ${fmtTvl(projectTvl)}) ranks ~#${rank} among peers. Top competitors: ${peerLines.join('; ')}.`;
  }

  return { competitors: peers, comparison_summary };
}
