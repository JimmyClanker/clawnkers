# Clawnkers Scoring Engine v2 — Decisioni Finali e Specifiche di Build

**Da:** Andrea (CEO)  
**A:** Jimmy 🦊 (COO)  
**Data:** 25 marzo 2026  
**Stato:** Approvato — inizia a buildare

---

## Contesto

Questo documento sintetizza le decisioni prese dalla sessione di analisi strategica (Andrea + Claude) e dalla review di Jimmy. Dove le analisi divergevano, qui c'è la decisione finale. Dove convergevano, conferma con eventuali precisazioni.

Il documento di review di Jimmy è stato valutato eccellente. Le criticità sollevate sono state tutte accettate e integrate nelle decisioni finali.

---

## Decisioni Architetturali Confermate

### 1. Obiettivo del prodotto

Clawnkers è un **alpha scanner per trader retail**. Il trader paga $1 USDC su Base e ottiene un report di investimento completo con verdetto, trade setup, red flags, tesi bull/bear, e confidence score. L'obiettivo non è produrre alpha autonomamente, ma fornire una **tesi di investimento attendibile** che considera tutti i fattori possibili.

L'orizzonte naturale del sistema è **investimento / position trading (2 settimane - 3 mesi)**. Non è un tool di swing trading né di day trading. Questa posizione è definitiva.

### 2. Da descrittivo a predittivo

Il scoring attuale descrive lo stato corrente del token. Il nuovo scoring deve **predire la performance futura relativa a BTC**. Questa è la trasformazione fondamentale.

### 3. Architettura LLM: Opus + Grok Fast

| Modello | Ruolo | Quando |
|---------|-------|--------|
| Grok fast (`grok-4-1-fast-non-reasoning`) | Data collector per X/Twitter | Chiamato in parallelo con gli altri collector nella Fase 1 del pipeline |
| Claude Opus 4.6 (via Claude Max subscription) | Sintesi finale del report | Chiamato nella Fase 3 del pipeline, riceve tutti i dati incluso output Grok |

**Motivazioni:**
- Opus ha costo marginale zero (incluso nell'abbonamento Claude Max ~€180/mese)
- Grok fast è economico (frazioni di centesimo per call) e ha accesso X nativo
- Ogni modello fa ciò che sa fare meglio: Grok raccoglie dati social, Opus sintetizza
- Per la fase di test questo elimina il problema costi LLM

**⚠️ NOTA CRITICA: OAuth solo per dev/calibrazione**
- OAuth (Claude Max) è usabile SOLO per sviluppo, test e calibrazione — MAI per uso commerciale
- Quando il prodotto va in produzione commerciale, ENTRAMBI i modelli devono usare API key:
  - Anthropic API key per Opus/Sonnet
  - xAI API key per Grok fast
- Usare OAuth per commercializzare un prodotto è vietato dai ToS
- Costo stimato per report in produzione: ~$0.15-0.25 (Opus) + ~$0.01 (Grok fast) = ~$0.16-0.26
- Con pricing $1/scan → margine lordo ~$0.74-0.84 per report — sostenibile
- Il codice deve essere progettato per switchare facilmente da OAuth a API key (config flag)

**Implicazioni implementative su llm.js:**
- La call Grok fast va separata dalla sintesi. Diventa un collector a tutti gli effetti, non parte del layer di synthesis
- Grok fast riceve un prompt corto: "Dammi le ultime discussioni su X riguardo a {token}, con sentiment, KOL principali, e narrativa dominante. Output JSON strutturato."
- L'output Grok viene iniettato nei rawData come `rawData.x_social` prima che Opus lo riceva
- Il `buildPrompt()` per Opus resta sostanzialmente identico al prompt attuale di Grok, con riadattamento del formato di chiamata (API Anthropic messages standard, no `XAI_RESPONSES_URL`, no `output_text`)
- Grok fast va lanciato in parallelo con i collector nella Fase 1 per non aggiungere latenza seriale

**Flow risultante:**
```
Phase 1 (parallelo):
  ├── CoinGecko collector
  ├── DeFiLlama collector
  ├── DexScreener collector
  ├── GitHub collector
  ├── Exa AI collector
  ├── Reddit collector
  ├── Holders collector
  ├── Ecosystem collector
  ├── Contract collector
  ├── Tokenomics collector (semi-dipendente da market)
  └── Grok fast X collector  ← NUOVO, in parallelo con gli altri

Phase 2: Scoring algoritmico (invariato + nuove feature)

Phase 3: Opus 4.6 synthesis (riceve tutto, incluso output Grok)
```

### 4. Repo pubblico

Il repo resta pubblico. L'algoritmo non è il moat — i **dati di calibrazione** (scan_snapshots, scan_performance, token_outcomes) lo sono. Il codice pubblico è marketing e trust per il target crypto-native. L'unica cosa fuori dal repo: dati di calibrazione grezzi e API key.

### 5. Priorità: dati prima di modelli

Senza ground truth:
- I pesi category-specific sono opinioni sofisticate
- I moltiplicatori leading/lagging sono opinioni sofisticate
- Le soglie di regime sono opinioni sofisticate

L'ordine di priorità è: **salvare dati → circuit breakers → category weights → tutto il resto**.

---

## Decisioni sulle Criticità della Review

### Criticità 1: Overengineering — ACCETTATA
Il regime filter è stato deprioritizzato a Fase 8. Non si implementa finché non c'è evidenza che lo score base abbia capacità predittiva. I moltiplicatori leading/lagging partono conservativi e vengono calibrati solo con dati reali (Fase 7).

### Criticità 2: Moltiplicatori leading/lagging — CORRETTA
Moltiplicatori iniziali rivisti:
- **Leading: 1.35** (non 1.8)
- **Coincident: 1.0**
- **Lagging: 0.7** (non 0.4)

Questi sono prior iniziali, non verità. I dati li correggeranno in Fase 7.

### Criticità 3: Doppio conteggio leadingBonus — CORRETTA
Il leadingBonus additivo viene eliminato nel design iniziale.

**Opzione A (preferita):** I moltiplicatori di classe vengono applicati dentro i dimension score, pesando i singoli componenti. Es: dentro `scoreSocialMomentum()`, il componente `institutional_mentions` viene moltiplicato per 1.35.

**Opzione B:** Il bonus separato esiste ma solo per segnali veramente ortogonali che non sono già dentro nessun dimension score (es: sentiment-price divergence, cross-dimension signal).

Jimmy sceglie l'approccio che produce codice più pulito e testabile.

### Criticità 4: Category confidence — ACCETTATA
`getCategoryWeights()` deve restituire un `category_confidence` (0-1). Se confidence è bassa (< 0.5), i pesi vengono interpolati verso il default:

```
pesi_effettivi = pesi_categoria * confidence + pesi_default * (1 - confidence)
```

### Criticità 5: Feedback leakage LLM — ACCETTATA
Regola ferma: **l'algoritmo decide score e vincoli, il LLM spiega e sintetizza**. Il LLM non può ribaltare un circuit breaker. Il prompt deve contenere:

```
Your verdict MUST NOT exceed the algorithmic cap of X/10.
If circuit breakers are active, explain WHY they are justified,
do not argue against them.
```

### Criticità 6: Target numerici — ACCETTATA
I target (55% hit rate BUY, 60% AVOID, ecc.) restano interni. La pagina /methodology viene pubblicata solo dopo Fase 9.

---

## Architettura Scan Periodici — APPROVATA

### Token Universe: 150 token iniziali

| Categoria | N. token |
|-----------|---------|
| Top market cap | 50 |
| DeFi | 20 |
| AI / Infra | 20 |
| Meme | 20 |
| L1/L2 | 20 |
| Emerging / Trending (rotazione) | 20 |
| **Totale** | **~150** |

### 3 Livelli di scan confermati

| Livello | Cosa | Frequenza | Costo LLM |
|---------|------|-----------|-----------|
| 0 — Market Snapshot | Price/volume/DEX essentials | 1-4h su Tier A | $0 |
| 1 — Predictive Score | Score completo + circuit breakers + signals | 6-24h | $0 |
| 2 — LLM Premium | Grok fast (X data) + Opus (synthesis) | On-demand / escalation | Basso |

### Database schema confermato
Le 5 tabelle (token_universe, token_snapshots, token_scores, token_outcomes, llm_reports) + oracle_signals.

### Cron jobs confermati
```
Job A — snapshot-market      (1h, Tier A)
Job B — snapshot-enriched    (24h, Tier A + B interessante)
Job C — snapshot-outcomes    (24h, backfill 7/14/30/60/90d)
Job D — escalation-review    (2-4h, trigger-based)
```

---

## Alpha Oracle — APPROVATO come modulo interno

5 tipi di segnale confermati:
1. **Score Momentum** — delta score > 1.0 in 72h
2. **Category Leader Shift** — cambio top 3 per categoria
3. **Circuit Breaker Alert** — breaker si attiva/disattiva
4. **Divergence Signal** — sentiment-price divergence forte + score sopra soglia
5. **Regime Shift** — cambio regime di mercato (quando implementato)

Oracle viene implementato in Fase 6, dopo che l'infra di scan periodici è attiva.

---

## Roadmap Finale con Timeline

### FASE 1: Foundation Data Loop (questa settimana)
- Schema SQLite: token_universe, token_snapshots, token_scores, token_outcomes
- Ogni full scan salva price_at_scan + btc_price_at_scan
- Zero impatto sul flow attuale — solo aggiunta di storage
- **Criterio:** ogni scan produce un record in token_snapshots

### FASE 2: Circuit Breakers (questa settimana / prossima)
- Implementa circuit-breakers.js come da specifica
- Integra come post-processing in calculateScores()
- Cap sul verdict esposto chiaramente nel report
- Nuovi test per ogni circuit breaker
- I 15 test esistenti devono continuare a passare
- **Criterio:** un token con whale concentration 70% non può mai ottenere > 4.0

### FASE 3: Category-Adaptive Weighting (settimana 2)
- Implementa getCategoryWeights() con category_confidence
- Mappa iniziale: meme, defi_lending, defi_dex, layer_1, layer_2, ai_infrastructure, default
- Interpolazione verso default quando confidence < 0.5
- Backward-compatible: test esistenti usano pesi default
- **Criterio:** calculateScores() restituisce category nel risultato

### FASE 4: Periodic Scanning + Grok Fast Collector (settimane 2-3)
- Popola token_universe con 150 token iniziali
- Implementa cron Job A (market snapshot, 1h)
- Implementa cron Job B (enriched score, 24h)
- Implementa cron Job C (outcome tracker, 24h)
- Nuovo collector: Grok fast per X social data
- Integra Grok fast in parallelo nella Phase 1 del pipeline
- Migra la synthesis in llm.js da Grok reasoning a Opus 4.6
- **Criterio:** 150 token hanno snapshot giornalieri e outcome tracking attivo

### FASE 5: Measurement Dashboard (settimana 3-4)
- Endpoint interno /alpha/metrics con:
  - Hit rate BUY vs BTC (30d)
  - Hit rate AVOID vs BTC (30d)
  - Spearman correlation score↔return
  - Circuit breaker protection rate
  - Performance per categoria
- Pagina web interna (non pubblica) per visualizzare le metriche
- **Criterio:** dashboard mostra metriche reali su dati accumulati

### FASE 6: Alpha Oracle (settimana 4-5)
- oracle/signal-detector.js — delta tra snapshot consecutivi
- 5 tipi di segnale come da specifica
- Tabella oracle_signals
- API: GET /oracle/signals, /oracle/top-movers, /oracle/watchlist
- Webhook opzionale (Discord/Telegram)
- Tool MCP: get_oracle_signals
- **Criterio:** il sistema genera segnali automatici senza intervento umano

### FASE 7: Recalibration (dopo 3+ mesi di dati)
- Analisi correlazione per dimensione per categoria
- Ricalibra pesi category-specific con dati reali
- Ricalibra moltiplicatori leading/lagging
- Pubblica risultati nella dashboard interna
- **Criterio:** almeno un ciclo di ricalibrazione basato su dati reali

### FASE 8: Regime Filter (dopo validazione nucleo)
- Regime detection BTC-based
- Soglie adattive per verdetto
- Solo dopo evidenza di capacità predittiva base

### FASE 9: Go Public (dopo 3+ mesi)
- Pagina /methodology pubblica con metriche reali
- Pagina /track-record pubblica
- OpenTimestamps anchoring
- Pricing subscription per Oracle
- Quick scan gratuito come lead gen

---

## Principi Guida (da rispettare in ogni fase)

1. **Dati prima di modelli** — Snapshot store è la fondazione non negoziabile
2. **Deterministico prima di LLM** — Score, breakers, signals sono codice, non prompt
3. **Conservativo prima di aggressivo** — Moltiplicatori moderati, poi i dati decidono
4. **Misurabile prima di vendibile** — Dashboard interna prima di marketing esterno
5. **Modulare** — Ogni fase aggiunge senza rompere il precedente
6. **Cheap-first** — LLM solo per premium/escalation, mai per routine
7. **I 15 test esistenti devono sempre passare** — Nessuna fase li rompe
8. **Verifica sempre, non fare deduzioni** — Vale per i dati come per il codice

---

## Decisioni Strategiche Confermate

| Decisione | Stato |
|-----------|-------|
| Repo pubblico | ✅ Confermato |
| Nessun token | ✅ Confermato |
| No swing trading claims | ✅ Confermato |
| ClawMart e Moltify in pausa | ✅ Confermato |
| Focus su scoring engine v2 | ✅ Confermato |
| Oracle come modulo interno | ✅ Confermato |
| Hit rate vs BTC come metrica primaria | ✅ Confermato |
| Target modesti e onesti | ✅ Confermato |
| Opus per synthesis, Grok fast per X data | ✅ Confermato |

---

**Jimmy, inizia da Fase 1. Quando hai lo schema SQLite e lo snapshot store funzionante, fammi sapere e passiamo a Fase 2.**

— Andrea
