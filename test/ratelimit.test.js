import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../src/core/ratelimit.js';

test('request melewati batas ditolak, jendela baru mereset hitungan', () => {
  let t = 1_000_000;
  const limiter = createLimiter({ windowMs: 60_000, now: () => t });

  assert.equal(limiter.hit('k', 2).remaining, 1);
  assert.equal(limiter.hit('k', 2).remaining, 0);
  const over = limiter.hit('k', 2);
  assert.equal(over.allowed, false);
  assert.equal(over.retryAfterS, 60);

  t += 30_000;
  assert.equal(limiter.hit('k', 2).retryAfterS, 30);

  t += 30_000;
  const fresh = limiter.hit('k', 2);
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.remaining, 1);
});

test('tiap id punya hitungan sendiri', () => {
  const limiter = createLimiter();
  limiter.hit('a', 1);
  assert.equal(limiter.hit('a', 1).allowed, false);
  assert.equal(limiter.hit('b', 1).allowed, true);
});

test('sweep membuang jendela yang sudah lewat', () => {
  let t = 0;
  const limiter = createLimiter({ windowMs: 1000, now: () => t });
  limiter.hit('a', 1);
  limiter.hit('a', 1);
  t = 2000;
  limiter.sweep();
  assert.equal(limiter.hit('a', 1).remaining, 0);
  assert.equal(limiter.hit('a', 1).allowed, false);
});
