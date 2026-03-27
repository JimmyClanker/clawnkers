#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { getCalibrationDb } from './db.js';

const DAYS = Number(process.argv.find((v, i, a) => a[i - 1] === '--days') || 30);
const OUT = process.argv.includes('--out')
  ? resolve(process.cwd(), process.argv[process.argv.indexOf('--out') + 1])
  : resolve(process.cwd(), 'ops', 'feature-usefulness-2026-03-27.md');

const DIMENSIONS = [
  ['market_score', 'Market'],
  ['onchain_score', 'Onchain'],
  ['social_score', 'Social'],
  ['dev_score', 'Development'],
  ['tokenomics_score', 'Tokenomics'],
  ['distribution_score', 'Distribution'],
  ['risk_score', 'Risk'],
];

function fmt(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'n/a';
  return Number(v).toFixed(2);
}

function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'n/a';
  return `${Number(v).toFixed(2)}%`;
}

function getSamples(db, days) {
  return db.prepare(`
    SELECT
      ts.market_score,
      ts.onchain_score,
      ts.social_score,
      ts.dev_score,
      ts.tokenomics_score,
      ts.distribution_score,
      ts.risk_score,
      ts.overall_score,
      o.relative_return_pct
    FROM token_scores ts
    JOIN token_outcomes o ON o.snapshot_id = ts.snapshot_id
    WHERE o.days_forward = ?
      AND o.relative_return_pct IS NOT NULL
  `).all(days);
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function correlation(xs, ys) {
  if (xs.length < 5 || ys.length < 5 || xs.length !== ys.length) return null;
  const xMean = avg(xs);
  const yMean = avg(ys);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - xMean;
    const dy = ys[i] - yMean;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

function analyzeDimension(rows, key, label) {
  const filtered = rows.filter((r) => r[key] != null && r.relative_return_pct != null);
  if (filtered.length < 5) {
    return { label, key, samples: filtered.length, status: 'insufficient_data' };
  }

  const xs = filtered.map((r) => Number(r[key]));
  const ys = filtered.map((r) => Number(r.relative_return_pct));
  const corr = correlation(xs, ys);

  const sorted = [...filtered].sort((a, b) => Number(a[key]) - Number(b[key]));
  const split = Math.max(1, Math.floor(sorted.length / 2));
  const low = sorted.slice(0, split);
  const high = sorted.slice(sorted.length - split);

  const lowAvg = avg(low.map((r) => Number(r.relative_return_pct)));
  const highAvg = avg(high.map((r) => Number(r.relative_return_pct)));

  return {
    label,
    key,
    samples: filtered.length,
    correlation: corr,
    low_avg_relative_return: lowAvg,
    high_avg_relative_return: highAvg,
    delta_high_minus_low: (highAvg != null && lowAvg != null) ? highAvg - lowAvg : null,
  };
}

function buildMarkdown(days, rows, analyses) {
  const lines = [];
  lines.push(`# Feature Usefulness — ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Window analizzata: **${days} giorni forward**`);
  lines.push(`Samples totali disponibili: **${rows.length}**`);
  lines.push('');
  lines.push('| Dimension | Samples | Corr. vs return rel. BTC | Low half avg | High half avg | Delta high-low |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const a of analyses) {
    lines.push(`| ${a.label} | ${a.samples} | ${fmt(a.correlation)} | ${fmtPct(a.low_avg_relative_return)} | ${fmtPct(a.high_avg_relative_return)} | ${fmtPct(a.delta_high_minus_low)} |`);
  }
  lines.push('');
  lines.push('## Initial read');
  if (rows.length < 20) {
    lines.push('- Dataset troppo piccolo per conclusioni robuste. Usare questo report solo come base metodologica.');
  } else {
    const sorted = [...analyses].filter((a) => a.delta_high_minus_low != null).sort((a, b) => (b.delta_high_minus_low - a.delta_high_minus_low));
    if (sorted[0]) lines.push(`- Dimensione più promettente per ora: **${sorted[0].label}** (delta ${fmtPct(sorted[0].delta_high_minus_low)}).`);
    if (sorted[sorted.length - 1]) lines.push(`- Dimensione più debole per ora: **${sorted[sorted.length - 1].label}** (delta ${fmtPct(sorted[sorted.length - 1].delta_high_minus_low)}).`);
    lines.push('- Non cambiare i pesi in produzione su questo report da solo; usarlo insieme al calibration report bucketed.');
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const db = getCalibrationDb();
  const rows = getSamples(db, DAYS);
  const analyses = DIMENSIONS.map(([key, label]) => analyzeDimension(rows, key, label));
  const md = buildMarkdown(DAYS, rows, analyses);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, md);
  console.log(`Wrote ${OUT}`);
  console.log(`Samples=${rows.length}`);
}

main();
