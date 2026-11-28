import { getCatalog, getMonthlyRecommendationCount } from '@/data/repository.ts';
import { GiftFinderForm } from './gift-finder-form.tsx';
import { SavedPicks } from './saved-picks.tsx';
import { eventIds, relationIds } from '@/engine/labels.ts';
import { parseResultQuery } from '@/lib/result-query.ts';

export const dynamic = 'force-dynamic';

// 결과 화면 '조건 바꾸기'는 지금 조건을 주소에 담아 온다 (/?event=&relation=&budget=&qty=) → 고른 상태로 연다
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ config }, monthly, sp] = await Promise.all([getCatalog(), getMonthlyRecommendationCount(), searchParams]);
  const events = eventIds(config).map((id) => ({ id, name: config.events[id].name }));
  const relations = relationIds(config).map((id) => ({ id, name: config.relations[id].name }));
  const q = parseResultQuery(sp);
  const initial = events.some((e) => e.id === q.event) && relations.some((r) => r.id === q.relation)
    ? { event: q.event, relation: q.relation, budget: q.budget, qty: q.qty, budgetMode: q.budgetMode, totalBudget: q.totalBudget }
    : null;

  return (
    <main className="mobile">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden />답례큐<small>답례 큐레이션</small></a>
      </header>

      <section style={{ marginTop: 24 }}>
        <h1>자리에 맞는 답례,<br />답례큐가 골라 드립니다</h1>
        <p className="lead">행사와 받는 분, 예산만 알려 주세요. 격식지수로 비교해 지역 답례품 세 가지를 추천합니다.</p>
        {/* 숫자가 너무 적으면 오히려 신뢰를 깎으므로 10번 이상일 때만 보인다 */}
        {monthly !== null && monthly >= 10 && (
          <p className="usage-line"><span className="brand-mark" aria-hidden />이번 달 <b className="num">{monthly.toLocaleString('ko-KR')}</b>번 답례를 골라 드렸습니다</p>
        )}
      </section>

      <GiftFinderForm events={events} relations={relations} initial={initial} />

      <SavedPicks />

      {/* 보조 길 세 가지는 한 줄로: 추천 없이 꾸미기 · 저장한 디자인 · 격식지수 설명 */}
      <nav className="small muted home-links" aria-label="다른 길">
        <a className="text-link" href="/packaging/pick">상품 골라 포장만 꾸미기</a>
        <span aria-hidden>·</span>
        <a className="text-link" href="/packaging/mine">내 디자인</a>
        <span aria-hidden>·</span>
        <a className="text-link" href="/formality">격식지수란?</a>
      </nav>
    </main>
  );
}
