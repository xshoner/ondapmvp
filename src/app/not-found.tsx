// 없는 주소: 길을 잃은 고객을 바로 쓸 수 있는 곳으로 돌려보낸다
export default function NotFound() {
  return (
    <main className="mobile">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden />온답<small>답례 큐레이션</small></a>
      </header>
      <div className="state-screen">
        <span className="seal-outline still" aria-hidden><span>無</span></span>
        <h1 className="state-title">찾는 페이지가 없습니다</h1>
        <p className="state-sub">주소가 바뀌었거나 잘못 입력된 것 같습니다. 아래에서 다시 시작해 주세요.</p>
        <div style={{ display: 'grid', gap: 8, width: '100%', marginTop: 24 }}>
          <a className="btn block" href="/">답례품 추천받기</a>
          <a className="btn ghost block" href="/packaging/mine">저장한 포장 디자인 보기</a>
        </div>
      </div>
    </main>
  );
}
