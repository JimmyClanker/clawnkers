# AutoResearch — Alpha Scanner

You are an autonomous research agent improving the Alpha Scanner codebase.

## Setup

Before each experiment:
```bash
cd ~/clawd/projects/x402-research
node --test test/*.test.js
```
All 15 tests must pass. If they don't, fix them first.

## What you can modify

- `collectors/*.js` — data collection from CoinGecko, DeFiLlama, GitHub, Messari, Exa
- `synthesis/scoring.js` — scoring algorithm (5 dimensions + overall)
- `synthesis/llm.js` — Grok prompt engineering
- `synthesis/templates.js` — report formatting
- `public/alpha.html` — UI (chalkboard style)
- `routes/alpha.js` — route logic, caching, response building

## What you must NOT modify

- `test/*.test.js` — tests are the ground truth
- `config.js` — configuration
- `server.js` — server bootstrap
- `services/*.js` — core services
- `collectors/fetch.js` — shared fetch module
- `collectors/github-repos.json` — manual mapping

## Experiment loop

1. **Read** the current code and understand it
2. **Identify** one specific improvement (performance, accuracy, code quality, UX)
3. **Implement** the change
4. **Test**: `node --test test/*.test.js` — all must pass
5. **Validate**: if the change affects scoring, run a quick benchmark:
   ```bash
   node -e "
   import { collectAll } from './collectors/index.js';
   import { calculateScores } from './synthesis/scoring.js';
   const projects = ['ethereum', 'solana', 'aave'];
   for (const p of projects) {
     const data = await collectAll(p, null);
     const scores = calculateScores(data);
     console.log(p, 'overall:', scores.overall.score, 'completeness:', scores.overall.completeness + '%');
   }
   "
   ```
6. **Log** the experiment: what you changed, why, and the result
7. **Keep or discard**: if tests pass and the change is an improvement, keep it. Otherwise revert.
8. **Repeat** from step 1

## Improvement priorities (in order)

1. **Scoring accuracy** — do the scores reflect reality? Are weights sensible?
2. **Data coverage** — can collectors extract more useful data?
3. **Error resilience** — graceful degradation when APIs fail
4. **Performance** — reduce response time, optimize parallel fetching
5. **Code quality** — reduce duplication, improve naming, add JSDoc
6. **UX** — improve the chalkboard UI, better formatting

## Constraints

- No new npm dependencies
- No breaking API changes
- Keep the chalkboard visual style
- Don't add external API keys beyond what's already configured
- Each experiment should be small and focused (one change at a time)
- Always explain your reasoning before making changes

## Metric

Primary: **all tests pass** (15/15)
Secondary: **scoring benchmark** — scores should be reasonable (ETH 6-8, SOL 6-8, AAVE 5-7)
Tertiary: **code quality** — less duplication, better naming, more robust
