# Clawnkers Scoring Engine v2 — Review & Architecture Plan

**Autore**: Jimmy 🦊 (review del documento tecnico di Andrea + Claude)  
**Data**: 2026-03-25  
**Stato**: Analisi completa + architettura proposta + roadmap implementativa

---

## Parte 1: Review del Documento "Scoring Engine v2"

### Valutazione complessiva

- **Direzione concettuale:** 9/10
- **Prontezza per implementazione immediata as-is:** 6.5/10
- **Valore strategico per Clawnkers:** Altissimo

Il documento è forte perché sposta il focus da "rating cosmetico" a **sistema misurabile di forecasting**. È esattamente il tipo di moat che può rendere Clawnkers serio nel mercato.

---

### Punti di forza — Cosa condivido al 100%

#### 1. Diagnosi corretta: oggi lo score è descrittivo, non predittivo

Questo è il punto centrale. Se il sistema premia market cap, exchange count, followers, stars, stai sostanzialmente premiando **ciò che il mercato sa già**. Quello non genera alpha, al massimo genera una classifica di "asset rispettabili".

Un token con TVL in crescita, sentiment bullish, 100 commit in 90 giorni può ottenere 7.5/10 — ma se tutta questa informazione è già prezzata dal mercato, il token non farà nulla. Il valore aggiunto è trovare **discrepanze tra fondamentali e prezzo**.

#### 2. Category-adaptive weighting

Molto giusto. Un meme, un DeFi protocol e un L2 non possono avere la stessa funzione di scoring. Un meme coin dove il 70% della tesi è social momentum + whale behavior non può essere valutato con gli stessi pesi di un lending protocol dove contano TVL/fees/revenue. Questo da solo può migliorare parecchio la qualità percepita del prodotto.

#### 3. Circuit breakers / veto

Fortissimo. È una delle cose più importanti del documento. Nel mondo reale certi segnali non sono "-0.6 punti", sono **invalidanti**:

- Evita verdict ridicoli tipo BUY con rischio strutturale
- Rende il sistema più difendibile
- Migliora la coerenza tra score numerico e testo finale

Esempio: una whale concentration del 60% rende irrilevante qualsiasi analisi bullish. Una liquidità DEX < $10K significa che il trade setup è inutilizzabile.

#### 4. Definizione esplicita di "accuracy"

Forse il punto più strategico di tutti. Il contesto competitivo con AIXBT (31% vs 83% a seconda di chi misura) rivela il problema: **nessuno ha definito cosa significhi "accuratezza" per un crypto rating**.

Il primo che lo definisce con rigore e lo dimostra pubblicamente vince. Se Clawnkers diventa il primo a dire: cosa misura, come misura, con che benchmark, con quale hit rate reale — allora smette di essere "AI crypto opinion machine" e diventa infrastruttura di valutazione.

#### 5. Loop di auto-calibrazione

Un engine statico in crypto invecchia subito. Se non salvi snapshot + performance forward, non puoi mai dimostrare miglioramento. L'architettura scan → store → track → correlate → recalibrate è concettualmente corretta.

---

### Criticità e rischi identificati

#### Criticità 1: Rischio overengineering troppo presto

Il documento è ottimo concettualmente, ma se implementi tutto insieme rischi di costruire una macchina elegante che **non ha ancora abbastanza ground truth**.

La parte più importante NON è il regime filter o il classifier leading/lagging. La parte più importante è:

**Iniziare subito a salvare snapshot e outcome forward.**

Perché senza quello:
- I pesi category-specific sono opinioni sofisticate
- I moltiplicatori 1.8 / 1.0 / 0.4 sono opinioni sofisticate
- Le soglie di regime sono opinioni sofisticate

Buone opinioni, ma sempre opinioni. Solo i dati le possono validare.

#### Criticità 2: Leading vs lagging — concetto giusto, implementazione fragile

L'idea è corretta. Però alcuni segnali classificati come "leading" potrebbero non esserlo in modo stabile:

- **Social sentiment**: può essere rumorosissimo o manipolato
- **"Institutional mentions"**: rischia di essere un proxy sporco
- **Volume spike senza price move**: può significare accumulation… oppure wash trading / market making / spoofing soft

Il framework dovrebbe essere usato **non come verità hard**, ma come:
- Prior iniziale ragionevole
- Ipotesi da validare con i dati raccolti nel tempo

#### Criticità 3: Category detection — bootstrap problem

Se la categoria è sbagliata, tutto lo score downstream viene distorto.

Esempi problematici:
- Token AI con TVL zero e hype social alto → il sistema può scambiarlo per meme
- Protocollo early-stage DeFi con GitHub forte ma revenue ancora zero → può essere mal pesato

**Suggerimento**: la categoria deve avere `category_confidence`, e se confidence è bassa, i pesi devono restare più vicini al default anziché applicare pesi estremi.

#### Criticità 4: Regime filter — utile ma non prioritario

È sensato, ma meno urgente di quanto sembri. Prima devi capire se il tuo score ha capacità predittiva **in assoluto** e **vs BTC**. Solo dopo ha senso affinare il verdetto per regime.

Se lo implementi troppo presto rischi di aumentare la complessità del sistema prima di aver validato il nucleo.

#### Criticità 5: Feedback leakage — self-justifying system

Se Grok riceve categoria, leading signals, circuit breaker, regime, divergence — devi stare attento che il layer LLM **non inizi a teatralizzare decisioni già prese dall'algoritmo** come se fossero scoperte autonome.

**Regola**: algoritmo decide score/verdict constraints, LLM spiega e sintetizza. LLM come interprete, non come giudice finale. Non deve "ribaltare" i vincoli né inventare nuove basi per contraddirli.

---

### Suggerimenti specifici di revisione

#### A. Moltiplicatori fissi 1.8 / 1.0 / 0.4

Troppo precisi per essere inizialmente veri. Partire con qualcosa di più conservativo:
- leading: 1.35
- coincident: 1.0
- lagging: 0.7

Poi lasciare che siano i dati a dire se estremizzare.

#### B. Bonus additivo leadingBonus

Attenzione a non creare doppio conteggio. Se un segnale è già dentro `scoreSocialMomentum` o `scoreOnchainHealth`, poi aggiungerlo come bonus separato può gonfiare lo score due volte.

Meglio:
- O integrare il signal class weighting dentro i dimension score
- O usare il bonus separato, ma su segnali **davvero ortogonali** al resto

#### C. Target numerici

Sensati, ma tenerli interni all'inizio. Pubblicamente non parlare subito di target 55/60/65%. Prima raccogliere dati. Poi comunicare.

---

## Parte 2: Sistema di Scan Periodici — Architettura Cheap-First

### Principio fondamentale

Il 90% degli scan periodici deve essere **deterministico**, senza LLM. Grok/LLM solo come livello premium o su subset selezionato.

### Token Universe — 3 Tier

| Tier | Dimensione | Descrizione | Frequenza scan |
|------|-----------|-------------|----------------|
| **A — Core** | 100-300 token | Top market cap, leader per categoria, competitor | Regolare |
| **B — Opportunistic** | 100-500 token | Trending, nuovi listing, spike anomali | Leggero + escalation |
| **C — On-demand** | Illimitato | User-triggered | Full scan completo |

### 3 Livelli di scan

#### Livello 0 — Market Snapshot (ultra-cheap)
**Frequenza**: ogni 1-4 ore  
**Dati raccolti** (solo API gratuite/cheap):
- Price, volume, market cap, FDV
- Price change 1h/24h/7d
- Volume/mcap ratio
- ATH distance
- DEX liquidity (se disponibile)
- TVL e TVL change (dove applicabile)
- GitHub velocity (cached)
- Social mention count (cached)
- Holder concentration (cached, refresh lento)

**Output**: record compatto per token, nessun LLM, score preliminare puramente algoritmico.  
**Scopo**: alimenta il backtesting e il tracking storico.

#### Livello 1 — Predictive Score Refresh (no LLM)
**Frequenza**: ogni 6-24 ore su subset  
**Calcola**:
- Dimension scores completi
- Category detection
- Circuit breakers
- Leading signals
- Verdict preliminare

**Output**: `snapshot_score`, `snapshot_verdict`, `snapshot_features_json`  
**Scopo**: tracking storico, calibrazione, ranking interno, API cheap.

#### Livello 2 — LLM Synthesis Premium
**Frequenza**: solo quando serve  
**Trigger**:
- User paga / chiede full scan
- Token entra top X movers
- Token crossing threshold forte
- Divergence molto alta
- Score cambia drasticamente (+1.0 in 72h)
- Audit / QA interno

**Costo LLM**: non scala con la coverage dell'universo, solo con eventi importanti.

### Cache strategy per collector

| Fonte | Freshness target |
|-------|-----------------|
| Price/volume | 1h |
| DEX liquidity | 1-3h |
| Social mentions | 6-12h |
| GitHub | 24h |
| Holder concentration | 24-72h |
| Category / metadata | 7d |

### Scheduling pragmatico

| Frequenza | Cosa | Su chi |
|-----------|------|--------|
| Ogni 1h | Market data + DEX essentials | Tier A + top movers Tier B |
| Ogni 6h | Onchain, social, GitHub refresh light + recompute score | Tier A |
| Ogni 24h | Refresh completo + snapshot ufficiale per backtest | Tier A + Tier B interessante |
| Ogni 7d | Resync lento, pulizia categorie, refresh metadata, ranking | Tutto l'universo |

### Database schema

#### `token_universe` — Anagrafica
```sql
CREATE TABLE token_universe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  coingecko_id TEXT,
  chain TEXT,
  category TEXT,
  tier TEXT DEFAULT 'B',  -- A, B, C
  active BOOLEAN DEFAULT 1,
  added_at TEXT DEFAULT (datetime('now')),
  metadata_json TEXT
);
```

#### `token_snapshots` — Snapshot numerici periodici
```sql
CREATE TABLE token_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER NOT NULL,
  snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
  snapshot_level INTEGER DEFAULT 0,  -- 0=market, 1=enriched, 2=full
  
  -- Market
  price REAL,
  market_cap REAL,
  fdv REAL,
  volume_24h REAL,
  price_change_1h REAL,
  price_change_24h REAL,
  price_change_7d REAL,
  price_change_30d REAL,
  ath_distance_pct REAL,
  
  -- Onchain
  tvl REAL,
  tvl_change_7d REAL,
  fees_7d REAL,
  revenue_7d REAL,
  
  -- Social
  social_mentions INTEGER,
  sentiment_score REAL,
  
  -- Dev
  github_commits_30d INTEGER,
  github_commit_trend TEXT,
  
  -- Distribution
  holder_concentration REAL,
  
  -- DEX
  dex_liquidity REAL,
  buy_sell_ratio REAL,
  
  -- Context
  btc_price REAL,
  data_completeness REAL,
  freshness_json TEXT,
  
  FOREIGN KEY (token_id) REFERENCES token_universe(id)
);
```

#### `token_scores` — Output algoritmico
```sql
CREATE TABLE token_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  
  -- Dimension scores
  market_score REAL,
  onchain_score REAL,
  social_score REAL,
  dev_score REAL,
  tokenomics_score REAL,
  distribution_score REAL,
  risk_score REAL,
  
  -- Overall
  overall_score REAL,
  raw_score REAL,
  verdict TEXT,
  leading_bonus REAL,
  confidence REAL,
  
  -- Category
  category TEXT,
  category_confidence REAL,
  category_source TEXT,
  weights_json TEXT,
  
  -- Signals
  leading_signals_json TEXT,
  circuit_breakers_json TEXT,
  red_flags_count INTEGER,
  alpha_signals_count INTEGER,
  divergence_json TEXT,
  regime TEXT,
  
  FOREIGN KEY (snapshot_id) REFERENCES token_snapshots(id)
);
```

#### `token_outcomes` — Forward returns
```sql
CREATE TABLE token_outcomes (
  snapshot_id INTEGER NOT NULL,
  days_forward INTEGER NOT NULL,  -- 7, 14, 30, 60, 90
  checked_at TEXT NOT NULL,
  
  price_then REAL,
  price_now REAL,
  btc_price_then REAL,
  btc_price_now REAL,
  
  return_pct REAL,
  btc_return_pct REAL,
  relative_return_pct REAL,
  
  PRIMARY KEY (snapshot_id, days_forward)
);
```

#### `llm_reports` — Solo per scan premium (opzionale)
```sql
CREATE TABLE llm_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  model TEXT,
  report_json TEXT,
  cost_estimate REAL,
  created_at TEXT DEFAULT (datetime('now')),
  
  FOREIGN KEY (snapshot_id) REFERENCES token_snapshots(id)
);
```

### Universe iniziale consigliato

| Categoria | N. token | Esempi |
|-----------|---------|--------|
| Top market cap | 50 | BTC, ETH, SOL, BNB, XRP... |
| DeFi | 20 | AAVE, UNI, MKR, CRV, MORPHO... |
| AI / Infra | 20 | TAO, RENDER, FET, OCEAN, AKT... |
| Meme | 20 | DOGE, SHIB, PEPE, WIF, BONK... |
| L1/L2 | 20 | AVAX, NEAR, SUI, APT, ARB, OP... |
| Emerging / Trending | 20 | Rotazione dinamica |
| **Totale** | **~150** | |

Meglio 150 token ben tracciati che 2000 rumorosi e incompleti.

### Cron Jobs

```
Job A — snapshot-market
  Frequenza: 1h
  → Aggiorna market/dex essentials per Tier A
  → Salva snapshot livello 0

Job B — snapshot-enriched
  Frequenza: 24h
  → Aggiorna social/github/onchain più lenti
  → Calcola score completo
  → Salva snapshot livello 1

Job C — snapshot-outcomes
  Frequenza: 24h
  → Trova snapshot vecchi 7/14/30/60/90d
  → Calcola outcome assoluto e vs BTC
  → Aggiorna tabella outcomes

Job D — escalation-review (opzionale)
  Frequenza: 2-4h
  → Cerca trigger forti (delta score, divergence, breaker)
  → Seleziona 5-10 token
  → Refresh profondo
  → Opzionalmente chiama LLM su 1-3 casi
```

---

## Parte 3: Investment vs Swing Trading

### Per cosa è adatto il sistema

| Use case | Adatto? | Perché |
|----------|---------|--------|
| **Investimenti / position trading (2w-3m)** | ✅ Molto | I segnali usati (TVL, dev, narrative, distribution, divergence) sono lenti/medi e predittivi su orizzonti settimanali |
| **Swing trading puro (1-5 giorni)** | ⚠️ Parziale | Mancano layer tecnici: market structure, S/R, funding/OI, liquidations, entry trigger |
| **Day trading / scalping** | ❌ No | Sistema non progettato per questo timeframe |

### Cosa manca per lo swing trading

Per swing puro servirebbero layer fondamentali che oggi non ci sono:
- Market structure (HH/HL, LH/LL)
- Support/resistance
- Funding/open interest
- Perp positioning
- Liquidation levels
- Volatility compression/expansion
- Regime intraday
- Entry trigger tecnico con invalidation chiara

### Uso corretto per swing

Clawnkers può funzionare come **filtro direzionale** per lo swing:
1. Il motore seleziona i token migliori (ranking, conviction)
2. Sopra quei candidati si applica un layer tecnico separato
3. Solo allora si entra

**Clawnkers** = motore di selezione / priorità / conviction  
**Trading layer tecnico** = timing / rischio / esecuzione

### Architettura dual-score (futura)

| Score | Cosa misura | Timeframe | Layer |
|-------|-------------|-----------|-------|
| `investment_score` | Qualità/probabilità di outperform 30-90d | Settimane-mesi | Fondamentale-predittivo |
| `swing_setup_score` | Qualità del timing nei prossimi 1-5 giorni | Giorni | Tecnico-momentum |

Questa separazione è molto più pulita che mischiare tutto in un solo numero. Implementabile come fase futura dopo che il layer fondamentale è validato.

---

## Parte 4: Alpha Oracle — Modulo di Segnali Azionabili

### Concetto

L'Alpha Oracle è un **layer sopra lo scoring engine**, non un servizio separato. Condivide stessi collector, database, scoring, categorie, circuit breaker.

```
┌─────────────────────────────────────────┐
│         CLAWNKERS DATA LAYER            │
│  snapshots · scores · outcomes · cache  │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴───────┐
       │               │
       ▼               ▼
┌──────────────┐ ┌──────────────────┐
│ ALPHA SCANNER│ │  ALPHA ORACLE    │
│              │ │                  │
│ On-demand    │ │ Periodico        │
│ Deep scan    │ │ Event-driven     │
│ Single token │ │ Multi-token      │
│ $1/report    │ │ Subscription     │
│ Grok premium │ │ No LLM (o cheap)│
└──────────────┘ └──────────────────┘
```

### 5 tipi di segnale

#### 1. Score Momentum
> "AAVE è passato da 6.2 a 7.8 in 3 giorni — TVL +18%, dev acceleration, nessun circuit breaker"  
Trigger: score change > 1.0 in 72h

#### 2. Category Leader Shift
> "Nei DeFi lending, MORPHO ha superato COMPOUND nel ranking. Leading signals: TVL inflow + narrative momentum"  
Trigger: cambio top 3 per categoria

#### 3. Circuit Breaker Alert
> "PEPE ha attivato whale concentration breaker (42%) — score cappato a 6.5. Era 7.1 ieri"  
Trigger: breaker si attiva o disattiva

#### 4. Divergence Signal
> "TAO: sentiment score 0.65 ma prezzo -12% 7d. Bullish divergence forte. Score 7.4, categoria AI infra"  
Trigger: divergence forte + score sopra soglia

#### 5. Regime Shift
> "BTC -8% 30d: regime passato da bull a sideways. Soglie BUY alzate a 7.0. 12 token declassati da BUY a HOLD"  
Trigger: cambio regime

### Trigger-based escalation

Non fare full scan su 500 token. Full scan solo su quelli che "si accendono":

| Trigger | Soglia |
|---------|--------|
| Score delta | > 1.0 in 24h |
| Top ranking per categoria | Entra top 5 |
| Bullish divergence | Forte |
| Circuit breaker | Si attiva/disattiva |
| TVL inflow | > 20% con prezzo flat |
| Volume spike | Volume/mcap > 0.3 con price compression |
| Social surge + dev acceleration | Combinato |
| Performance anomala vs BTC | > 2σ |

### API endpoints Oracle

```
GET /oracle/signals              → ultimi segnali
GET /oracle/signals?type=divergence  → filtro per tipo
GET /oracle/signals?category=defi    → filtro per categoria
GET /oracle/top-movers           → ranking delta giornaliero
GET /oracle/watchlist            → token in zona calda
```

### Canali di distribuzione

- **API JSON**: per agenti, bot, integrazioni
- **Webhook**: push a Discord, Telegram, email
- **Feed RSS/Atom**: per chi vuole seguire
- **Dashboard web**: pagina dedicata su clawnkers.com
- **MCP tool**: un agente può chiedere "quali token meritano attenzione oggi?"

### Modello di business Oracle

| Piano | Cosa include | Pricing |
|-------|-------------|---------|
| **Free** | Top 3 segnali/giorno, delay 6-12h, senza dettaglio score | $0 |
| **Premium** | Tutti i segnali real-time, filtri, webhook, storico, hit rate | $X/mese (subscription) |
| **Agent API** | Endpoint MCP/REST per agenti AI | Per-call o subscription |

Il modello subscription è molto più scalabile del pay-per-scan e ha retention migliore.

### Implementazione tecnica

Nuovi file nel codebase:
```
oracle/
  signal-detector.js    — trova delta nei snapshot
  signal-types.js       — definizione dei 5+ tipi
  signal-ranker.js      — prioritizza per importanza
  signal-formatter.js   — formatta per output
  oracle-cron.js        — job periodico
```

Tabella aggiuntiva:
```sql
CREATE TABLE oracle_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_type TEXT NOT NULL,
  token_id INTEGER,
  severity TEXT,  -- info, warning, critical
  title TEXT,
  detail TEXT,
  data_json TEXT,
  generated_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  
  FOREIGN KEY (token_id) REFERENCES token_universe(id)
);
```

Cron Oracle (ogni 6h):
1. Carica ultimi 2 snapshot per ogni token
2. Calcola delta score, delta features, delta ranking
3. Applica trigger rules
4. Genera segnali
5. Filtra per importanza (top 5-10)
6. Salva in `oracle_signals`
7. Esponi via API / webhook / feed

### Cosa NON fare

- **NON creare un servizio separato** — duplichi infra, dati, manutenzione
- **NON fare segnali di trading espliciti** — per ragioni legali, non dire "compra X", dire "X ha attivato 3 segnali leading"
- **NON renderlo LLM-dependent** — segnali deterministici, LLM opzionale solo per brief narrativi

---

## Parte 5: Roadmap Integrata

### Ordine di implementazione raccomandato

```
┌─────────────────────────────────────────────────────────┐
│ FASE 1: Foundation Data Loop (1-2 giorni)               │
│ • Snapshot store (SQLite tables)                        │
│ • Salva price + BTC price per ogni scan                 │
│ • Zero impatto sul flow attuale                         │
├─────────────────────────────────────────────────────────┤
│ FASE 2: Hard Risk Discipline (3-5 giorni)               │
│ • Circuit breakers                                      │
│ • Cap sul verdict                                       │
│ • Esposizione chiara nel report                         │
│ • Migliora affidabilità SUBITO                          │
├─────────────────────────────────────────────────────────┤
│ FASE 3: Category-Adaptive Weighting (3-5 giorni)        │
│ • getCategoryWeights() con category_confidence          │
│ • Poche categorie iniziali, fallback forte al default   │
│ • Test backward-compatible                              │
├─────────────────────────────────────────────────────────┤
│ FASE 4: Periodic Scanning Infrastructure (3-5 giorni)   │
│ • Token universe (150 token iniziali)                   │
│ • Cron snapshot market (1h) + enriched (24h)            │
│ • Outcome tracker (7/14/30/60/90d vs BTC)              │
├─────────────────────────────────────────────────────────┤
│ FASE 5: Measurement Dashboard (2-3 giorni)              │
│ • Pagina interna con metriche chiave                    │
│ • Buy hit rate vs BTC                                   │
│ • Avoid hit rate vs BTC                                 │
│ • Score/return Spearman correlation                     │
│ • Breaker protection rate                               │
│ • Performance by category                               │
├─────────────────────────────────────────────────────────┤
│ FASE 6: Alpha Oracle Module (3-5 giorni)                │
│ • Signal detection su delta snapshot                    │
│ • 5 tipi di segnale                                    │
│ • API endpoints                                         │
│ • Webhook / feed                                        │
├─────────────────────────────────────────────────────────┤
│ FASE 7: Leading/Lagging Recalibration (dopo 3+ mesi)    │
│ • Analisi correlazione dimensioni vs outcome            │
│ • Ottimizzazione moltiplicatori                         │
│ • Soglie per categoria                                  │
│ • Basato su DATI REALI, non opinioni                    │
├─────────────────────────────────────────────────────────┤
│ FASE 8: Regime Filter (dopo validazione nucleo)         │
│ • Regime detection BTC-based                            │
│ • Soglie adattive per verdetto                          │
│ • Solo dopo aver validato capacità predittiva base      │
├─────────────────────────────────────────────────────────┤
│ FASE 9: Subscription Model + Pubblico (dopo 3+ mesi)    │
│ • Hit rate verificabile pubblicamente                   │
│ • Pricing subscription Oracle                           │
│ • Pagina /methodology con metriche reali                │
└─────────────────────────────────────────────────────────┘
```

### Principi guida dell'implementazione

1. **Dati prima di modelli** — Snapshot store è la fondazione non negoziabile
2. **Deterministico prima di LLM** — Score, breakers, signals sono codice, non prompt
3. **Conservativo prima di aggressivo** — Moltiplicatori moderati, poi i dati decidono
4. **Misurabile prima di vendibile** — Dashboard interna prima di marketing esterno
5. **Modulare** — Ogni fase aggiunge senza rompere il precedente
6. **Cheap-first** — LLM solo per premium/escalation, mai per routine

### Stima costi API per 150 token

| Fonte | Call/giorno | Costo stimato |
|-------|-----------|---------------|
| CoinGecko (free) | ~3600 (150 × 24h) | $0 (free tier, rate limit 30/min) |
| DeFiLlama | ~600 (150 × 4h) | $0 (free, no key) |
| DexScreener | ~150 (1/giorno) | $0 (free tier) |
| GitHub API | ~150 (1/giorno) | $0 (free, rate limit 5000/h) |
| Social (cached) | ~150 (1/giorno) | $0 se web scraping / ~$10/mese se API |
| **Grok LLM (premium only)** | **3-10/giorno** | **~$1-5/giorno** |
| **Totale stimato** | | **$30-150/mese** |

Il grosso del costo è il LLM, che con questa architettura viene usato solo per scan premium e escalation.

---

## Parte 6: Decisioni strategiche prese

1. **ClawMart e Moltify: IN PAUSA** — Focus su affidabilità del prodotto core
2. **Priorità: scoring engine v2** — Da descrittivo a predittivo
3. **Investimento > swing trading** — Il sistema è naturalmente adatto a orizzonti settimanali-mensili
4. **Oracle come modulo interno** — Non servizio separato, stessa infra
5. **LLM-last** — Deterministico per scan routine, LLM solo per premium
6. **Accuracy definita** — Hit rate relativo vs BTC come metrica primaria
7. **Target modesti e onesti** — Meglio promettere 55% e consegnare 60% che promettere 80% e consegnare 40%

---

*Documento compilato da Jimmy 🦊 — 25 Marzo 2026*  
*Basato su: review del documento tecnico Scoring Engine v2 + architettura scan periodici + analisi use case + design Alpha Oracle*
