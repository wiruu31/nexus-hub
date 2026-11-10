// Jendela tetap per id, disimpan di memori. Hitungan kembali nol saat server restart.
export function createLimiter({ windowMs = 60_000, now = Date.now } = {}) {
  const buckets = new Map();

  return {
    hit(id, limit) {
      const t = now();
      let bucket = buckets.get(id);
      if (!bucket || t >= bucket.resetAt) {
        bucket = { count: 0, resetAt: t + windowMs };
        buckets.set(id, bucket);
      }
      bucket.count += 1;
      return {
        allowed: bucket.count <= limit,
        limit,
        remaining: Math.max(0, limit - bucket.count),
        resetAt: bucket.resetAt,
        retryAfterS: Math.max(1, Math.ceil((bucket.resetAt - t) / 1000)),
      };
    },

    sweep() {
      const t = now();
      for (const [id, bucket] of buckets) if (t >= bucket.resetAt) buckets.delete(id);
    },
  };
}
