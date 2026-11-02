'use client';

import React from 'react';
import type { ApprovalDocumentModel } from '@/approval/types.ts';
import { won } from '@/lib/result-query.ts';

export function ApprovalPreview({ model }: { model: ApprovalDocumentModel }) {
  const {
    eventName,
    eventDateText,
    authorText,
    eventCategoryName,
    relationCategoryName,
    purposeText,
    selectedCandidate,
    selectedPlanLabel,
    quantity,
    unitPrice,
    itemTotal,
    extraCostNote,
    budgetStatus,
    selectedReason,
    additionalNote,
    hasInternalLimit,
    perPersonLimitCheckText,
    hasScheduleOrNote,
    deliveryScheduleText,
    approverTitles,
    candidateRows,
    hasShortage,
    shortageReason,
    createdDateText,
    catalogDateText,
    documentId,
    revision,
    draftNotice,
  } = model;

  const hasApprovers = approverTitles && approverTitles.length > 0;

  return (
    <div className="a4-preview-wrapper" style={{ overflowX: 'auto', padding: '12px 0' }}>
      <div
        className="a4-sheet"
        style={{
          width: '100%',
          maxWidth: '794px', // A4 96dpi 기준 794px x 1123px
          minHeight: '1050px',
          margin: '0 auto',
          backgroundColor: '#ffffff',
          color: '#111827',
          padding: '44px 48px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
          boxSizing: 'border-box',
          fontSize: '15px', // 12pt 내외 표준 가독성
          lineHeight: '1.55',
          fontFamily:
            '"Nanum Gothic", "Malgun Gothic", -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif',
        }}
      >
        {/* 상단: 결재란 (우측 상단 배치) */}
        {hasApprovers && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <table
              style={{
                borderCollapse: 'collapse',
                textAlign: 'center',
                border: '1px solid #111827',
                fontSize: '13px',
              }}
            >
              <tbody>
                <tr>
                  <th
                    rowSpan={2}
                    style={{
                      width: 26,
                      backgroundColor: '#F2F2F2',
                      border: '1px solid #111827',
                      padding: '4px',
                      fontWeight: 700,
                      color: '#111827',
                      lineHeight: '1.3',
                      letterSpacing: '2px',
                    }}
                  >
                    결<br />재
                  </th>
                  {approverTitles.map((title, idx) => (
                    <th
                      key={idx}
                      style={{
                        padding: '3px 12px',
                        fontWeight: 600,
                        backgroundColor: '#F2F2F2',
                        border: '1px solid #111827',
                        minWidth: 64,
                        color: '#111827',
                        lineHeight: '1.2',
                      }}
                    >
                      {title}
                    </th>
                  ))}
                </tr>
                <tr>
                  {approverTitles.map((_, idx) => (
                    <td
                      key={idx}
                      style={{
                        height: 48,
                        border: '1px solid #111827',
                        backgroundColor: '#FFFFFF',
                      }}
                    />
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* 문서 제목 (중앙 정렬, 공문서 서식) */}
        <div style={{ textAlign: 'center', margin: hasApprovers ? '12px 0 24px' : '0 0 24px' }}>
          <h1
            style={{
              margin: 0,
              fontSize: '24px',
              fontWeight: 800,
              color: '#111827',
              letterSpacing: '2px',
            }}
          >
            답례품 선정 검토서
          </h1>
        </div>

        {/* 1. 기안 정보 */}
        <SectionHeader title="1. 기안 정보" />
        <table style={tableStyle}>
          <tbody>
            <tr>
              <th style={{ ...thStyle, width: '18%' }}>행 사 명</th>
              <td style={{ ...tdStyle, width: '32%' }}><b>{eventName}</b></td>
              <th style={{ ...thStyle, width: '18%' }}>행 사 일</th>
              <td style={{ ...tdStyle, width: '32%' }}>{eventDateText}</td>
            </tr>
            <tr>
              <th style={thStyle}>기 안 자</th>
              <td style={tdStyle}>{authorText}</td>
              <th style={thStyle}>작 성 일</th>
              <td style={tdStyle}>{createdDateText}</td>
            </tr>
            <tr>
              <th style={thStyle}>대상·수량</th>
              <td colSpan={3} style={tdStyle}>
                {relationCategoryName} ({eventCategoryName} 기준) / <b>{quantity.toLocaleString('ko-KR')}개</b>
              </td>
            </tr>
            {purposeText && (
              <tr>
                <th style={thStyle}>추진 목적</th>
                <td colSpan={3} style={tdStyle}>{purposeText}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 2. 선정 개요 */}
        <SectionHeader title="2. 선정 개요" />
        <table style={tableStyle}>
          <tbody>
            <tr>
              <th style={{ ...thStyle, width: '20%' }}>최종 선정안</th>
              <td style={tdStyle}>
                <b>{selectedPlanLabel} [선택]</b> {selectedCandidate.productName}
              </td>
            </tr>
            <tr>
              <th style={thStyle}>선정 사유</th>
              <td style={tdStyle}>{selectedReason}</td>
            </tr>
            <tr>
              <th style={thStyle}>소요 금액</th>
              <td style={tdStyle}>
                단가 {won(unitPrice)} × {quantity.toLocaleString('ko-KR')}개 = <b>상품 합계 {won(itemTotal)}</b>
                <span style={{ display: 'block', fontSize: '13px', color: '#4B5563', marginTop: 2 }}>
                  ※ {extraCostNote}
                </span>
              </td>
            </tr>
            <tr>
              <th style={thStyle}>예산 비교</th>
              <td style={tdStyle}>
                <b>{budgetStatus}</b>
              </td>
            </tr>
            {hasInternalLimit && perPersonLimitCheckText && (
              <tr>
                <th style={thStyle}>내부 가액 기준</th>
                <td style={tdStyle}>{perPersonLimitCheckText}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 3. 추천 상품 비교 */}
        <SectionHeader title="3. 추천 상품 비교 (대안 검토)" />
        {hasShortage && shortageReason && (
          <p style={{ margin: '4px 0 8px', fontSize: 13, color: '#111827' }}>※ {shortageReason}</p>
        )}
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: '18%', textAlign: 'center' }}>구분</th>
              {candidateRows.map((r) => (
                <th
                  key={r.candidate.productNo}
                  style={{
                    ...thStyle,
                    textAlign: 'center',
                    fontWeight: r.isSelected ? 800 : 600,
                  }}
                >
                  {r.planLabel} {r.isSelected ? '[선택]' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th style={{ ...thStyle, textAlign: 'center' }}>참고 상품 사진</th>
              {candidateRows.map((r) => (
                <td
                  key={r.candidate.productNo}
                  style={{
                    ...tdStyle,
                    textAlign: 'center',
                    padding: '8px 4px',
                  }}
                >
                  {r.candidate.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.candidate.imageUrl}
                      alt={r.candidate.productName}
                      style={{
                        width: 76,
                        height: 76,
                        objectFit: 'cover',
                        border: '1px solid #111827',
                        display: 'block',
                        margin: '0 auto',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 76,
                        height: 76,
                        backgroundColor: '#F2F2F2',
                        lineHeight: '76px',
                        color: '#6B7280',
                        fontSize: 12,
                        margin: '0 auto',
                        border: '1px solid #D1D5DB',
                      }}
                    >
                      [사진 없음]
                    </div>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th style={{ ...thStyle, textAlign: 'center' }}>상품명</th>
              {candidateRows.map((r) => (
                <td
                  key={r.candidate.productNo}
                  style={{
                    ...tdStyle,
                    fontWeight: r.isSelected ? 700 : 400,
                  }}
                >
                  {r.isSelected ? '▶ ' : ''}{r.candidate.productName}
                </td>
              ))}
            </tr>
            <tr>
              <th style={{ ...thStyle, textAlign: 'center' }}>단가 / 수량</th>
              {candidateRows.map((r) => (
                <td key={r.candidate.productNo} style={tdStyle}>
                  {won(r.unitPrice)} / {r.quantity.toLocaleString('ko-KR')}개
                </td>
              ))}
            </tr>
            <tr>
              <th style={{ ...thStyle, textAlign: 'center' }}>상품 합계</th>
              {candidateRows.map((r) => (
                <td
                  key={r.candidate.productNo}
                  style={{
                    ...tdStyle,
                    fontWeight: r.isSelected ? 800 : 600,
                  }}
                >
                  {won(r.itemTotal)}
                </td>
              ))}
            </tr>
            <tr>
              <th style={{ ...thStyle, textAlign: 'center' }}>핵심 특징</th>
              {candidateRows.map((r) => (
                <td
                  key={r.candidate.productNo}
                  style={{
                    ...tdStyle,
                    fontSize: '13.5px',
                    lineHeight: '1.45',
                  }}
                >
                  <b>{r.tier}</b> (
                    {r.candidate.model === 'core-contract-v1'
                      ? `추천점수 ${(r.recommendationScore ?? r.matchScore).toFixed(1)}점 · 희소값 ${(r.rarityValue ?? 0).toFixed(1)}점`
                      : `${r.candidate.model === 'v2' ? '상품 희소값' : '격식지수'} ${r.matchScore}점`}
                  )<br />
                  {r.keyFeature ?? r.reason}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {/* 4. 추진 일정 및 비고 (사용자가 행사일 또는 메모를 입력한 경우에만 표시) */}
        {hasScheduleOrNote && (
          <>
            <SectionHeader title="4. 추진 일정 및 비고" />
            <table style={tableStyle}>
              <tbody>
                {deliveryScheduleText && (
                  <tr>
                    <th style={{ ...thStyle, width: '20%' }}>추진 일정</th>
                    <td style={tdStyle}>{deliveryScheduleText}</td>
                  </tr>
                )}
                {additionalNote && additionalNote.trim() && (
                  <tr>
                    <th style={{ ...thStyle, width: '20%' }}>비 고</th>
                    <td style={tdStyle}>{additionalNote.trim()}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {/* 하단 메타 정보 */}
        <div style={{ marginTop: 24, paddingTop: 12, borderTop: '1px solid #111827', fontSize: 12, color: '#4B5563' }}>
          <p style={{ margin: '0 0 4px' }}>
            작성일: {createdDateText} | 자료 기준일: {catalogDateText}
          </p>
          <p style={{ margin: 0, fontSize: 11 }}>
            {draftNotice}
          </p>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2
      style={{
        margin: '18px 0 8px',
        fontSize: '16px',
        fontWeight: 700,
        color: '#111827',
      }}
    >
      {title}
    </h2>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  border: '1px solid #111827',
  marginBottom: 12,
};

const thStyle: React.CSSProperties = {
  backgroundColor: '#F2F2F2',
  border: '1px solid #111827',
  padding: '8px 10px',
  fontSize: '14.5px',
  fontWeight: 600,
  color: '#111827',
  verticalAlign: 'middle',
  textAlign: 'left',
};

const tdStyle: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  border: '1px solid #111827',
  padding: '8px 10px',
  fontSize: '14.5px',
  color: '#111827',
  verticalAlign: 'middle',
};
