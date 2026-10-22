import { getCatalog, getMonthlyRecommendationCount } from '@/data/repository.ts';
import { GiftFinderForm } from './gift-finder-form.tsx';
import { SavedPicks } from './saved-picks.tsx';
import { eventIds, relationIds } from '@/engine/labels.ts';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [{ config }, monthly] = await Promise.all([getCatalog(), getMonthlyRecommendationCount()]);
  const events = eventIds(config).map((id) => ({ id, name: config.events[id].name }));
  const relations = relationIds(config).map((id) => ({ id, name: config.relations[id].name }));

  return (
    <main className="mobile">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden />온답<small>답례 큐레이션</small></a>
      </header>

      <section style={{ marginTop: 24 }}>
        <h1>자리에 맞는 답례,<br />온답이 골라 드립니다</h1>
        <p className="lead">행사와 받는 분, 예산만 알려 주세요. 격식지수로 비교해 지역 답례품 세 가지를 추천합니다.</p>
        {/* 숫자가 너무 적으면 오히려 신뢰를 깎으므로 10번 이상일 때만 보인다 */}
        {monthly !== null && monthly >= 10 && (
          <p className="usage-line"><span className="brand-mark" aria-hidden />이번 달 <b className="num">{monthly.toLocaleString('ko-KR')}</b>번 답례를 골라 드렸습니다</p>
        )}
      </section>

      <GiftFinderForm events={events} relations={relations} />

      <SavedPicks />

      <p className="small muted" style={{ textAlign: 'center', margin: '28px 0 0' }}>
        추천 없이 원하는 상품의 포장만 꾸미려면 <a className="text-link" href="/packaging/pick">상품 고르기</a>
      </p>
      <p className="small muted" style={{ textAlign: 'center', margin: '8px 0 0' }}>
        저장한 포장 디자인은 <a className="text-link" href="/packaging/mine">내 디자인</a>에서 다시 볼 수 있습니다
      </p>
      <p className="small muted" style={{ textAlign: 'center', margin: '8px 0 0' }}>
        <a className="text-link" href="/formality">격식지수란?</a> 온답이 답례품을 고르는 방법
      </p>
    </main>
  );
}
