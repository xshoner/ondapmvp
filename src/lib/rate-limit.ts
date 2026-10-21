// 간단한 요청 횟수 제한 (서버 인스턴스 메모리 기준).
// 서버가 여러 대로 늘면 인스턴스마다 따로 센다 → 남용을 줄이는 1차 방어이고, 정확한 제한이 필요하면 DB나 KV로 옮긴다.

export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return function allow(key: string, now = Date.now()): boolean {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, ts] of hits) if (ts.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    return true;
  };
}

// 프록시(Vercel)가 붙여 주는 실제 접속 주소. 첫 번째 값이 고객 주소
export function clientIp(h: Headers): string {
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}
