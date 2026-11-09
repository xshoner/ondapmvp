import { redirect } from 'next/navigation';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * 기존 실적 메뉴(/admin/stats)의 북마크 및 링크를 대시보드(/admin) 첫 화면으로 안전하게 연결합니다.
 * 기존 쿼리 파라미터(기간, 시작일, 종료일 등)를 보존하여 리다이렉트합니다.
 */
export default async function StatsRedirectPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') {
      q.set(k, v);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        q.append(k, item);
      }
    }
  }
  const qs = q.toString();
  redirect(qs ? `/admin?${qs}` : '/admin');
}
