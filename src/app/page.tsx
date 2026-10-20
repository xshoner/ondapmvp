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
        <a className="brand" href="/">ONDAP<small>온답</small></a>
        <a className="small muted" href="/admin">관리자</a>
      </header>

      <section style={{ marginTop: 12 }}>
        <h1>내 상황에 맞는<br />답례를 찾아드릴게요</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          행사와 받는 분을 알려주시면 격식에 맞는 지역 답례품 3가지를 골라드립니다.
        </p>
      </section>

      <GiftFinderForm events={events} relations={relations} />
    </main>
  );
}
