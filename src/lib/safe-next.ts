// 로그인 후 돌아갈 주소 검사 (오픈 리다이렉트 방지)
// 같은 사이트의 /admin 이하 경로만 허용하고, 그 밖의 값은 모두 /admin으로 바꾼다.
// "/\evil.com"처럼 브라우저가 외부 주소로 해석하는 형태도 걸러낸다.

const FALLBACK = '/admin';
const BASE = 'http://local.invalid';

export function safeNext(next: unknown): string {
  if (typeof next !== 'string') return FALLBACK;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\u0000-\u001F\u007F]/.test(next)) {
    return FALLBACK;
  }
  try {
    const u = new URL(next, BASE);
    if (u.origin !== BASE) return FALLBACK;
    if (u.pathname !== '/admin' && !u.pathname.startsWith('/admin/')) return FALLBACK;
    return u.pathname + u.search + u.hash;
  } catch {
    return FALLBACK;
  }
}
