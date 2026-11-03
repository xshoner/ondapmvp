'use client';

interface Props {
  currentStep: 1 | 2 | 3;
  onStepClick: (step: 1 | 2 | 3) => void;
}

const STEPS = [
  { no: 1 as const, name: '포장지 선택', desc: '어울리는 포장 디자인' },
  { no: 2 as const, name: '인쇄물 꾸미기', desc: '추천 템플릿과 문구' },
  { no: 3 as const, name: '최종 확인', desc: '포장 모습과 주문 접수' },
];

export function StepNavigation({ currentStep, onStepClick }: Props) {
  return (
    <nav className="step-nav-bar" aria-label="포장 제작 단계">
      <ol className="step-nav-list">
        {STEPS.map((s) => {
          const isCurrent = s.no === currentStep;
          const isDone = s.no < currentStep;
          const isClickable = s.no <= currentStep;

          return (
            <li
              key={s.no}
              className={`step-nav-item ${isCurrent ? 'active' : ''} ${isDone ? 'done' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <button
                type="button"
                className="step-nav-btn"
                disabled={!isClickable}
                onClick={() => onStepClick(s.no)}
                title={`${s.name} (${s.desc})`}
              >
                <span className="step-badge">
                  {isDone ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    s.no
                  )}
                </span>
                <span className="step-text-wrap">
                  <span className="step-name">{s.name}</span>
                  <span className="step-desc-desktop">{s.desc}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
