'use client';

import { useState } from 'react';
import { CARD_SHORT_MM, PX_PER_MM_RANGE, loadPxPerMm, savePxPerMm } from '../editor-store.ts';
import { totalCm } from '@/packaging/rules.ts';
import type { StickerShape } from '@/packaging/types.ts';

interface Props {
  png: string;
  sizeCm: number;
  shape: StickerShape;
  clip: string;
  onClose: () => void;
}

export function RealSizeModal({ png, sizeCm, shape, clip, onClose }: Props) {
  const [pxPerMm, setPxPerMm] = useState(loadPxPerMm);

  return (
    <div className="real-view" role="dialog" aria-modal="true" aria-label="실제 인쇄 크기로 보기">
      <div className="real-stage">
        <img
          src={png}
          alt="실제 크기 스티커"
          style={{ width: totalCm(sizeCm) * 10 * pxPerMm, clipPath: clip }}
        />
      </div>

      <div className="real-panel">
        <div className="spread">
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>
              {shape === 'circle' ? '지름' : '한 변'} {sizeCm}cm, 실제 인쇄 크기
            </p>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              이 크기에서 이름과 글자가 잘 읽히는지 확인해 보세요.
            </p>
          </div>
          <button type="button" className="btn small" onClick={onClose}>
            닫기
          </button>
        </div>

        <details className="disclosure" style={{ marginTop: 12 }}>
          <summary className="small" style={{ fontWeight: 600, cursor: 'pointer' }}>
            화면 크기 맞추기 (신용카드 기준)
          </summary>
          <p className="small muted" style={{ margin: '8px 0' }}>
            신용카드 짧은 변(5.4cm)을 모니터 화면에 대고, 아래 막대가 카드와 일치하도록 조절해 주세요.
          </p>
          <div className="card-ruler" style={{ width: CARD_SHORT_MM * pxPerMm }} />
          <input
            type="range"
            min={PX_PER_MM_RANGE[0]}
            max={PX_PER_MM_RANGE[1]}
            step={0.02}
            value={pxPerMm}
            aria-label="화면 배율"
            style={{ width: '100%', marginTop: 8 }}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPxPerMm(v);
              savePxPerMm(v);
            }}
          />
        </details>
      </div>
    </div>
  );
}
