'use client';

import type { AiSuggestion } from '@/ai/suggest.ts';
import type { EngineConfig, ProductAttributes } from '@/engine/types.ts';

type Props = {
  config: EngineConfig;
  draft: ProductAttributes;
  suggestion: AiSuggestion;
  onApplyScore: (id: string, value: number) => void;
  onApplyScores: () => void;
  onApplyAll: () => void;
  onClose: () => void;
};

export function AiSuggestionPanel({ config, draft, suggestion: s, onApplyScore, onApplyScores, onApplyAll, onClose }: Props) {
  const eventName = (id: string) => config.events[id as keyof typeof config.events]?.name ?? id;
  const relationName = (id: string) => config.relations[id as keyof typeof config.relations]?.name ?? id;
  const meanings = Object.entries(s.meanings);

  return (
    <section style={{ border: '1px solid #cfe0d6', background: '#f4f9f6', borderRadius: 12, padding: 16, margin: '0 0 18px' }}>
      <div className="spread">
        <b style={{ color: 'var(--green)' }}>✦ AI 점수 제안</b>
        <span className="small muted">{s.model} · 확인 후 적용하고 저장해야 반영됩니다</span>
      </div>
      {s.summary && <p className="small" style={{ margin: '6px 0 10px' }}>{s.summary}</p>}

      <table className="data" style={{ background: '#fff' }}>
        <thead>
          <tr>
            <th style={{ top: 0 }}>지표</th>
            <th style={{ top: 0 }} className="right">현재</th>
            <th style={{ top: 0 }} className="right">제안</th>
            <th style={{ top: 0 }}>근거</th>
            <th style={{ top: 0 }} />
          </tr>
        </thead>
        <tbody>
          {config.indicators.map((ind) => {
            const cur = draft.scores[ind.id] ?? 0;
            const sug = s.scores[ind.id];
            if (sug === undefined) return null;
            const diff = sug - cur;
            return (
              <tr key={ind.id}>
                <td>{ind.name}</td>
                <td className="right">{cur}</td>
                <td className="right">
                  <b>{sug}</b>
                  {diff !== 0 && <span className="small" style={{ color: diff > 0 ? 'var(--green)' : 'var(--red)', marginLeft: 4 }}>{diff > 0 ? `+${diff}` : diff}</span>}
                </td>
                <td className="small">{s.reasons[ind.id]}</td>
                <td>
                  {diff !== 0 && <button type="button" className="btn ghost small" onClick={() => onApplyScore(ind.id, sug)}>적용</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="small" style={{ display: 'grid', gap: 4, marginTop: 12 }}>
        <div><b>어울리는 행사</b> · {s.events.length ? s.events.map(eventName).join(', ') : '없음'}</div>
        <div><b>어울리는 관계</b> · {s.relations.length ? s.relations.map(relationName).join(', ') : '없음'}</div>
        {s.excludedEvents.length > 0 && (
          <div style={{ color: 'var(--red)' }}><b>제외 제안</b> · {s.excludedEvents.map((x) => `${eventName(x.event)}(${x.reason})`).join(', ')}</div>
        )}
        {meanings.length > 0 && (
          <div><b>선물의 의미</b> · {meanings.map(([ev, m]) => `${eventName(ev)}: ${m}`).join(' / ')}</div>
        )}
        {s.tags.length > 0 && <div><b>태그</b> · {s.tags.map((t) => `#${t}`).join(' ')}</div>}
        {s.region && <div><b>산지</b> · {s.region}{draft.region && draft.region !== '국내' && draft.region !== s.region ? ` (현재 "${draft.region}" 유지)` : ''}</div>}
      </div>

      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost small" onClick={onClose}>닫기</button>
        <button type="button" className="btn ghost small" onClick={onApplyScores}>점수만 적용</button>
        <button type="button" className="btn small" onClick={onApplyAll}>모두 적용</button>
      </div>
    </section>
  );
}
