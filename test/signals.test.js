import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignalsService } from '../services/signals.js';

test('signals service ingests, filters, and reports stats', () => {
  const service = createSignalsService({
    dbPath: ':memory:',
    maxBatchSignals: 100,
    ingestKey: 'x'.repeat(32),
  });

  service.ingestSignals([
    {
      timestamp: new Date().toISOString(),
      symbol: 'btc',
      direction: 'LONG',
      strategy: 'DIVERGENCE',
      entry: 100,
      sl: 90,
      tp: 130,
      rr: 3,
      context: { tf: '1h' },
    },
    {
      timestamp: new Date().toISOString(),
      symbol: 'eth',
      direction: 'SHORT',
      strategy: 'CONVERGENCE',
      entry: 200,
      sl: 210,
      tp: 150,
      rr: 2.5,
      context: { tf: '4h' },
    },
  ]);

  const btc = service.getSignals({ coin: 'BTC', hours: 24 });
  assert.equal(btc.count, 1);
  assert.equal(btc.signals[0].symbol, 'BTC');
  assert.equal(btc.signals[0].context.tf, '1h');

  const divergence = service.getSignals({ type: 'div', hours: 24 });
  assert.equal(divergence.count, 1);
  assert.equal(divergence.signals[0].strategy, 'DIVERGENCE');

  const stats = service.getStats();
  assert.equal(stats.totalStored, 2);
  assert.equal(stats.last24h, 2);
  assert.equal(stats.byStrategy7d.DIVERGENCE, 1);
  assert.equal(stats.byStrategy7d.CONVERGENCE, 1);

  service.close();
});

test('signals service enforces batch limits', () => {
  const service = createSignalsService({
    dbPath: ':memory:',
    maxBatchSignals: 1,
    ingestKey: 'x'.repeat(32),
  });

  assert.throws(
    () => service.ingestSignals([{ symbol: 'BTC' }, { symbol: 'ETH' }]),
    /Max 1 signals per batch/
  );

  service.close();
});
