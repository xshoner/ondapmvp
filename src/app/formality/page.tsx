import type { Metadata } from 'next';
import { getCatalog } from '@/data/repository.ts';
import { eventIds } from '@/engine/labels.ts';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '격식지수란 | 온답',
  description: '같은 선물도 자리마다 뜻이 다릅니다. 온답이 행사와 받는 분에 맞춰 답례품을 고르는 방법을 소개합니다.',
};

const HANJA: Record<string, string> = {
  funeral: '弔', wedding: '婚', longevity: '壽', birth: '誕', promotion: '榮', opening: '開', thanks: '謝', birthday: '生',
};

// 격식지수 소개: 관리자가 바꾼 설정(지표·목표·보너스)을 그대로 읽어 보여 준다
export default async function FormalityPage() {
  const { config } = await getCatalog();
  const b = config.bonus;
  const events = eventIds(config).map((id) => [id, config.events[id]] as const);
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

  return (
    <main className="mobile" style={{ paddingBottom: 56 }}>
      <header className="topbar">
        <a className="back" href="/">‹ 처음으로</a>
        <a className="brand" href="/" style={{ fontSize: 18 }}><span className="brand-mark" aria-hidden />온답</a>
        <span style={{ width: 72 }} />
      </header>

      <section style={{ marginTop: 16 }}>
        <span className="seal-outline still" aria-hidden style={{ width: 56, height: 56, fontSize: 24 }}><span>禮</span></span>
        <h1 style={{ marginTop: 20 }}>격식지수는<br />답례가 놓일 자리를 봅니다</h1>
        <p className="lead">
          같은 선물도 장례와 생일에서는 뜻이 다릅니다. 온답은 행사와 받는 분, 예산에 맞춰 상품마다 0~100점의 격식지수를 매기고, 그 자리에 가장 알맞은 세 가지를 고릅니다.
        </p>
      </section>

      <section className="step">
        <h2 className="step-label">고르는 순서</h2>
        <ol className="formality-steps">
          <li><b>거르기</b><span>판매하지 않거나 예산을 넘는 상품, 그 자리에 맞지 않는 상품(예: 장례에 신선식품)을 먼저 뺍니다.</span></li>
          <li><b>지표 점수</b><span>상품마다 여섯 가지 지표를 매기고, 행사와 관계에 따라 무게를 달리해 더합니다.</span></li>
          <li><b>보태고 덜기</b><span>자리에 어울리는지, 선물에 담긴 뜻이 맞는지, 지역 상생 상품인지에 따라 점수를 보태거나 덜어 냅니다.</span></li>
          <li><b>세 가지 고르기</b><span>점수가 높은 순으로 고르되, 같은 종류가 겹치지 않게 합니다. 맞는 상품이 모자라면 예산을 조금 넓혀 찾습니다.</span></li>
        </ol>
      </section>

      <section className="step">
        <h2 className="step-label">여섯 가지 지표</h2>
        <dl className="indicator-list">
          {config.indicators.map((i) => (
            <div key={i.id}>
              <dt>{i.name}</dt>
              <dd>{i.mode === 'target' ? '품격과 가격대, 포장을 봅니다. 높을수록 좋은 것이 아니라 자리마다 정한 목표에 가까울수록 좋습니다.' : i.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="step">
        <h2 className="step-label">자리마다 다른 격식</h2>
        <p className="small muted" style={{ margin: '0 0 12px' }}>
          격식 적합도의 목표(10점 만점)입니다. 상급자나 어르신께는 목표를 조금 높이고, 가족이나 친구에게는 조금 낮춥니다.
        </p>
        <ul className="rank-bars formality-targets">
          {events.map(([id, e]) => (
            <li key={id}>
              <span className="rank-label"><span className="hanja-mini" aria-hidden>{HANJA[id] ?? '禮'}</span>{e.name}</span>
              <span className="rank-track"><span className="bar" style={{ width: `${e.formalityTarget * 10}%` }} /></span>
              <span className="rank-value num">{e.formalityTarget}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="step">
        <h2 className="step-label">보태고 덜어 내는 점수</h2>
        <table className="data bonus-table">
          <tbody>
            <tr><td>그 자리에 어울리는 상품</td><td className="right num">{signed(b.eventFit)}</td></tr>
            <tr><td>그 자리에 어울리지 않는 상품</td><td className="right num">{signed(b.eventMiss)}</td></tr>
            <tr><td>받는 분과의 관계에 어울리는 상품</td><td className="right num">{signed(b.relationFit)}</td></tr>
            <tr><td>선물에 담긴 뜻이 자리와 맞는 상품</td><td className="right num">{signed(b.meaning)}</td></tr>
            <tr><td>소멸위기지역 생산자 상품 (지역 상생)</td><td className="right num">{signed(b.depopulation)}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="step">
        <h2 className="step-label">세 가지 격식 단계</h2>
        <div className="tier-list">
          {config.tiers.map((t) => <div key={t.label}><span className="tier">{t.label}</span></div>)}
        </div>
        <p className="small muted" style={{ margin: '10px 0 0' }}>추천 결과에는 격을 갖춘 선택부터 가볍게 건네기 좋은 선택까지 단계를 나눠 보여 드립니다.</p>
      </section>

      <p className="small muted" style={{ marginTop: 36, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        지금 화면의 점수는 온답 격식지수 가안({config.modelVersion})을 기준으로 계산합니다. 산식은 실제 운영에 맞춰 다듬어질 수 있습니다.
      </p>
      <a className="btn block" href="/" style={{ marginTop: 20 }}>답례품 추천받기</a>
    </main>
  );
}
