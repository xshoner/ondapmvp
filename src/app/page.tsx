import { getCatalog } from '@/data/repository.ts';
import { GiftFinderForm } from './gift-finder-form.tsx';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { config } = await getCatalog();
  const events = Object.entries(config.events).map(([id, e]) => ({ id, name: e.name }));
  const relations = Object.entries(config.relations).map(([id, r]) => ({ id, name: r.name }));

  return (
    <main className="mobile">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden />온답<small>답례 큐레이션</small></a>
      </header>

      <section style={{ marginTop: 24 }}>
        <h1>자리에 맞는 답례,<br />온답이 골라 드립니다</h1>
        <p className="lead">행사와 받는 분, 예산만 알려 주세요. 격식지수로 비교해 지역 답례품 세 가지를 추천합니다.</p>
      </section>

      <GiftFinderForm events={events} relations={relations} />

      <p className="small muted" style={{ textAlign: 'center', margin: '28px 0 0' }}>
        추천 없이 원하는 상품의 포장만 꾸미려면 <a className="text-link" href="/packaging/pick">상품 고르기</a>
      </p>
    </main>
  );
}
