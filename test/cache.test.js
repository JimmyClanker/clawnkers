import test from 'node:test';
import assert from 'node:assert/strict';
import { LruTtlCache } from '../services/exa.js';

test('cache evicts least recently used entries', async () => {
  const cache = new LruTtlCache({ maxEntries: 2, ttlMs: 1000 });

  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a').value, 1);
  cache.set('c', 3);

  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('a').value, 1);
  assert.equal(cache.get('c').value, 3);
  cache.clear();
});

test('cache expires entries after ttl and tracks hits/misses', async () => {
  const cache = new LruTtlCache({ maxEntries: 2, ttlMs: 30 });
  cache.set('a', { ok: true });

  assert.deepEqual(cache.get('a').value, { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(cache.get('a'), null);

  const stats = cache.stats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
  cache.clear();
});
