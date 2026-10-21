import { MineView } from './mine-view.tsx';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// 내 디자인 다시 보기: /packaging/mine (?code=OD-XXXX-XXXX면 바로 조회)
export default async function MyDesignsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const code = typeof sp.code === 'string' ? sp.code.slice(0, 20) : '';
  return (
    <main className="mobile">
      <header className="topbar">
        <a className="back" href="/">‹ 처음으로</a>
        <span className="title">내 디자인</span>
        <span style={{ width: 72 }} />
      </header>
      <h1 style={{ fontSize: 26, marginTop: 8 }}>저장한 포장 디자인</h1>
      <p className="lead">디자인 코드를 다시 복사하거나 바로 주문하러 갈 수 있습니다.</p>
      <MineView initialCode={code} />
    </main>
  );
}
