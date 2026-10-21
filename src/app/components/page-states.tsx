// 기다림·빈 화면에 쓰는 공통 조각: 도장 자리가 천천히 숨 쉬듯 깜빡인다 (움직임 줄이기 설정이면 멈춤)

export function WaitingScreen({ title, sub }: { title: string; sub: string }) {
  return (
    <main className="mobile">
      <div className="state-screen" role="status" aria-live="polite">
        <span className="seal-outline" aria-hidden><span>禮</span></span>
        <h1 className="state-title">{title}</h1>
        <p className="state-sub">{sub}</p>
      </div>
    </main>
  );
}
