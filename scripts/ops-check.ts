// 외부 스케줄러에서 실행할 수 있는 읽기 전용 점검. 실패는 종료 코드 1. 인증값·응답 원문은 출력하지 않는다.
export {};
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) throw new Error('점검할 서비스 주소를 지정해 주세요.');
const results: { page: string; ok: boolean }[] = [];
for (const path of ['/', '/packaging/pick', '/formality', '/admin']) {
  try {
    const r = await fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    results.push({ page: path, ok: path === '/admin' ? r.status === 307 && Boolean(r.headers.get('location')?.includes('/login')) : r.ok });
  } catch { results.push({ page: path, ok: false }); }
}
if (process.env.CRON_SECRET) {
  try {
    const allowedOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://ondapmvp.vercel.app').origin;
    const url = new URL('/api/cron/health', base);
    if (url.origin !== allowedOrigin || (url.protocol !== 'https:' && url.hostname !== '127.0.0.1')) throw new Error('점검 인증을 보낼 서비스 주소가 일치하지 않습니다.');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    results.push({ page: 'dependencies', ok: r.ok && (await r.json()).ok === true });
  } catch { results.push({ page: 'dependencies', ok: false }); }
} else results.push({ page: 'dependencies_not_configured', ok: false });
console.log(JSON.stringify({ kind: 'ondap_external_check', results }));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
