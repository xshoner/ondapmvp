import { clientIp, createRateLimiter } from '@/lib/rate-limit.ts';
const allow = createRateLimiter({ limit: 60, windowMs: 60000 });
export async function POST(request: Request) {
  if (!allow(clientIp(request.headers))) return new Response(null, { status: 429 });
  try {
    const text = await request.text();
    if (text.length > 512) return new Response(null, { status: 413 });
    const v = JSON.parse(text);
    if (!['LCP','INP','CLS'].includes(v.name) || !['home','result','packaging'].includes(v.page) || !Number.isFinite(v.value) || v.value < 0 || v.value > 3600000) return new Response(null, { status: 400 });
    console.info(JSON.stringify({ kind: 'ondap_web_vital', name: v.name, page: v.page, value: Math.round(v.value * 1000) / 1000 }));
    return new Response(null, { status: 204 });
  } catch { return new Response(null, { status: 400 }); }
}
