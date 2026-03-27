#!/usr/bin/env node

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { getCalibrationDb } from './db.js';

const OUT = resolve(process.cwd(), 'ops', 'calibration-readiness-latest.json');

function getCount(db, sql, args = []) {
  return db.prepare(sql).get(...args)?.count ?? 0;
}

function main() {
  const db = getCalibrationDb();
  const snapshots = getCount(db, 'SELECT COUNT(*) AS count FROM token_snapshots');
  const scores = getCount(db, 'SELECT COUNT(*) AS count FROM token_scores');
  const outcomes = getCount(db, 'SELECT COUNT(*) AS count FROM token_outcomes');
  const rel7 = getCount(db, 'SELECT COUNT(*) AS count FROM token_outcomes WHERE days_forward = 7 AND relative_return_pct IS NOT NULL');
  const rel30 = getCount(db, 'SELECT COUNT(*) AS count FROM token_outcomes WHERE days_forward = 30 AND relative_return_pct IS NOT NULL');
  const rel90 = getCount(db, 'SELECT COUNT(*) AS count FROM token_outcomes WHERE days_forward = 90 AND relative_return_pct IS NOT NULL');

  const readiness = {
    generated_at: new Date().toISOString(),
    snapshots,
    scores,
    outcomes,
    relative_samples: {
      d7: rel7,
      d30: rel30,
      d90: rel90,
    },
    thresholds: {
      first_review_trigger: 100,
      production_reweight_trigger: 300,
    },
    status: {
      first_review_ready: rel7 >= 100,
      production_reweight_ready: rel30 >= 300,
    },
    summary: rel7 >= 100
      ? 'Enough 7d relative-return samples exist for a first serious review.'
      : `Not ready yet: only ${rel7} 7d relative-return samples. Target is 100.`
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(readiness, null, 2));
  console.log(JSON.stringify(readiness, null, 2));
}

main();
