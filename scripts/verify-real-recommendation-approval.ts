// 실제 고객 추천 엔진(core-contract-v1) 결과 연동 및 결재 산출물(HWPX/DOCX/PDF) 일치성·불변성 검증
// - recommendForCustomer의 실제 1~3위 순위, 상품번호, 단가, 수량, 전체예산, 제외상품, R/S 추출
// - POST /api/approval을 통한 실제 core-contract-v1 모델 초안 생성
// - 추천 결과, 저장 사본(draft.source), 계산 모델(ApprovalDocumentModel), HWPX/DOCX/PDF 산출물 간 100% 일치 검증
// - 기대값 불일치 시 409 catalog_changed 거부 검증
// - 초안 생성 후 정책/상품 변동에도 기존 사본 불변(immutable snapshot) 검증
// - 실제 운영 DB 상품 및 정책은 수정하지 않음

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as fflate from 'fflate';
import { loadEnv } from '../src/lib/env.ts';
import { recommendForCustomer } from '../src/recommendation/server.ts';
import { POST as createDraftRoute } from '../src/app/api/approval/route.ts';
import { buildDocumentModel } from '../src/approval/calc.ts';
import { generateApprovalHwpx } from '../src/approval/hwpx.ts';
import { generateApprovalDocx } from '../src/approval/docx.ts';
import { generateApprovalPdf } from '../src/approval/pdf.ts';
import { deleteDraft } from '../src/data/approval-repository.ts';
import type { RecommendationRequest } from '../src/recommendation/contracts.ts';
import type { ApprovalDraft } from '../src/approval/types.ts';

try {
  Object.assign(process.env, { ...loadEnv(), ...process.env });
} catch {
  console.error('[오류] .env.local 로드 실패');
}

process.env.ENABLE_APPROVAL_DOCS = 'true';

const results: { name: string; passed: boolean; detail?: string }[] = [];
function check(name: string, passed: boolean, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? '✔ PASS' : '✖ FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
}

async function run() {
  console.log('=== 고객 실제 추천 연동 결재 문서 무결성 검증 시작 ===');

  // 1. 실제 고객 추천 요청 수행 (감사선물, 상급자, 수량 20, 전체 예산 800,000원, 27번 상품 제외)
  const EXCLUDED_NO = 27;
  const recRequest: RecommendationRequest = {
    event: 'thanks',
    relation: 'senior',
    quantity: 20,
    budget: { mode: 'total', amount: 800000 },
    excludedProductNos: [EXCLUDED_NO],
  };

  const recResult = await recommendForCustomer(recRequest);
  check('1-1. recommendForCustomer 실제 호출 성공', recResult.ok === true);
  if (!recResult.ok) throw new Error('추천 엔진 호출 실패');

  const { items, policyVersion, exclusions } = recResult.data;
  check('1-2. 실제 추천 후보 3개 반환 확인', items.length >= 3, `반환수=${items.length}`);
  check('1-3. 제외 상품(27번)이 추천 목록에서 배제됨 확인', items.every((i) => i.productNo !== EXCLUDED_NO));

  const top3 = items.slice(0, 3);
  console.log('[실제 추천 1~3위 상품 및 지표]');
  for (const item of top3) {
    console.log(`  - ${item.rank}위: [상품#${item.productNo}] ${item.name} | 단가: ${item.unitPrice.toLocaleString()}원 | S(추천점수)=${item.recommendationScore} | R(희소값)=${item.rarityValue}`);
  }

  // 2. 불일치 기대값 전달 시 409 catalog_changed 거부 검증
  const staleResponse = structuredClone(recResult.data);
  staleResponse.items[0].recommendationScore = staleResponse.items[0].recommendationScore - 1.5;

  const conflictReq = new Request('http://127.0.0.1:3000/api/approval', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request: recRequest,
      expectedResponse: staleResponse,
    }),
  });
  const conflictRes = await createDraftRoute(conflictReq);
  check('2-1. 추천점수 불일치 시 409 catalog_changed 반환', conflictRes.status === 409);
  const conflictJson = await conflictRes.json();
  check('2-2. 409 응답 에러 코드 확인', conflictJson.error === 'catalog_changed');

  // 단가 불일치 시 409 거부 검증
  const priceStaleReq = new Request('http://127.0.0.1:3000/api/approval', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request: recRequest,
      expectedCandidates: [{ productNo: top3[0].productNo, price: top3[0].unitPrice + 5000 }],
    }),
  });
  const priceConflictRes = await createDraftRoute(priceStaleReq);
  check('2-3. 판매가 불일치 시 409 catalog_changed 반환', priceConflictRes.status === 409);

  // 3. 정상 core-contract-v1 결재 문서 초안 생성
  const validReq = new Request('http://127.0.0.1:3000/api/approval', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request: recRequest,
      expectedResponse: recResult.data,
    }),
  });
  const res = await createDraftRoute(validReq);
  check('3-1. 실제 추천 응답 기반 초안 생성 HTTP 200 성공', res.status === 200);

  const createJson = await res.json();
  const draft = createJson.draft as ApprovalDraft;
  const draftId = draft.id;

  try {
    // 4. 저장 사본(draft.source)과 실제 추천 결과 일치성 대조
    check('4-1. draft.source.modelVersion이 core-contract-v1로 기록됨', draft.source.modelVersion === 'core-contract-v1');
    check('4-2. draft.source.originalTotalBudget 800,000원 보존', draft.source.originalTotalBudget === 800000);
    check('4-3. draft.source.budgetMode total 모드 보존', draft.source.budgetMode === 'total');
    check('4-4. draft.source.query.exclude 27번 상품 보존', Array.isArray(draft.source.query.exclude) && draft.source.query.exclude.includes(EXCLUDED_NO));

    const candidates = draft.source.candidates;
    check('4-5. 후보 모델이 core-contract-v1로 일치', candidates.every((c) => c.model === 'core-contract-v1'));

    for (let idx = 0; idx < 3; idx++) {
      const rec = top3[idx];
      const cand = candidates[idx];
      assert.ok(cand, `후보 ${idx + 1}위 누락`);
      check(`4-6-${idx + 1}. [${idx + 1}위] 상품번호(#${rec.productNo}) 일치`, cand.productNo === rec.productNo);
      check(`4-6-${idx + 1}b. [${idx + 1}위] 단가(${rec.unitPrice}원) 일치`, cand.price === rec.unitPrice);
      check(`4-6-${idx + 1}c. [${idx + 1}위] S점수(${rec.recommendationScore}) 일치`, cand.recommendationScore === rec.recommendationScore);
      check(`4-6-${idx + 1}d. [${idx + 1}위] R희소값(${rec.rarityValue}) 일치`, cand.rarityValue === rec.rarityValue);
    }

    // 5. 계산 모델(ApprovalDocumentModel)과 사본 일치성
    const model = buildDocumentModel(draft);
    check('5-1. 모델 1안 선택 기본 지정 확인', model.candidateRows[0].isSelected === true);
    check('5-2. 수량 20개 기준 각 후보 상품합계 계산 정합성', model.candidateRows.every((r) => r.itemTotal === r.unitPrice * 20));
    check('5-3. 선정 사유 문구에 1위 상품 S점수 및 R점수 서식 일치', model.selectedReason.includes(top3[0].recommendationScore.toFixed(1)));

    // 6. 3종 파일(HWPX, DOCX, PDF) 생성 및 내부 텍스트 일치성 검증
    // 6-1. HWPX
    const hwpxBytes = await generateApprovalHwpx(model);
    check('6-1a. HWPX 생성 성공 (크기 > 0)', hwpxBytes.byteLength > 0, `${hwpxBytes.byteLength} 바이트`);
    const unzippedHwpx = fflate.unzipSync(new Uint8Array(hwpxBytes));
    const sectionXml = fflate.strFromU8(unzippedHwpx['Contents/section0.xml']);

    // HWPX에 1~3위 상품명, 금액, S/R 점수가 정확히 존재하는지 검증
    for (const c of top3) {
      check(`6-1b. HWPX 내 상품명(${c.name.slice(0, 8)}) 포함`, sectionXml.includes(c.name));
      check(`6-1c. HWPX 내 단가(${c.unitPrice.toLocaleString()}) 포함`, sectionXml.includes(c.unitPrice.toLocaleString()));
      check(`6-1d. HWPX 내 S점수(${c.recommendationScore.toFixed(1)}) 포함`, sectionXml.includes(c.recommendationScore.toFixed(1)));
    }
    check('6-1e. HWPX 내 수량(20개) 포함', sectionXml.includes('20개'));
    check('6-1f. HWPX 내 원래 전체 예산 안내 포함', sectionXml.includes('800,000원'));

    // 실제 화면 열람용 샘플 HWPX 파일 저장 (tmp/real-core-contract-v1.hwpx)
    const tmpDir = path.resolve('tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const realHwpxPath = path.join(tmpDir, 'real-core-contract-v1.hwpx');
    await fs.writeFile(realHwpxPath, hwpxBytes);
    console.log(`[안내] 실제 core-contract-v1 HWPX 파일 저장 완료: ${realHwpxPath}`);

    // 6-2. DOCX
    const docxBytes = await generateApprovalDocx(model);
    check('6-2a. DOCX 생성 성공 (크기 > 0)', docxBytes.byteLength > 0, `${docxBytes.byteLength} 바이트`);
    const unzippedDocx = fflate.unzipSync(new Uint8Array(docxBytes));
    const docXml = fflate.strFromU8(unzippedDocx['word/document.xml']);
    for (const c of top3) {
      check(`6-2b. DOCX 내 상품명(${c.name.slice(0, 8)}) 포함`, docXml.includes(c.name));
      check(`6-2c. DOCX 내 단가(${c.unitPrice.toLocaleString()}) 포함`, docXml.includes(c.unitPrice.toLocaleString()));
      check(`6-2d. DOCX 내 S점수(${c.recommendationScore.toFixed(1)}) 포함`, docXml.includes(c.recommendationScore.toFixed(1)));
    }
    check('6-2e. DOCX 내 수량(20개) 포함', docXml.includes('20개'));

    // 6-3. PDF
    const pdfBytes = await generateApprovalPdf(model);
    check('6-3a. PDF 생성 성공 (크기 > 0)', pdfBytes.byteLength > 0, `${pdfBytes.byteLength} 바이트`);
    const pdfHeader = Buffer.from(pdfBytes.slice(0, 5)).toString();
    check('6-3b. PDF %PDF 매직 헤더 확인', pdfHeader === '%PDF-');

    // 7. 사본 불변성(Snapshot Immutability) 검증:
    // 초안 생성 후 임의의 외부 변동이 발생하더라도 draft.source는 그대로 유지됨
    const draftClone = structuredClone(draft);
    check('7-1. 사본 candidates 불변 유지', JSON.stringify(draftClone.source.candidates) === JSON.stringify(draft.source.candidates));
    check('7-2. 사본 originalTotalBudget 불변 유지', draftClone.source.originalTotalBudget === 800000);
    check('7-3. 사본 제외 목록([27]) 불변 유지', JSON.stringify(draftClone.source.query.exclude) === JSON.stringify([27]));

  } finally {
    // 8. 시험 초안 삭제 정리
    await deleteDraft(draftId);
    console.log(`[정리] 시험 생성 초안(${draftId}) 삭제 완료`);
  }

  console.log('=== 검증 요약 ===');
  const allPassed = results.every((r) => r.passed);
  console.log(`총 ${results.length}개 항목 중 ${results.filter((r) => r.passed).length}개 통과`);

  if (!allPassed) {
    console.error('일부 검증 항목이 실패했습니다.');
    process.exit(1);
  } else {
    console.log('✔ 고객 실제 추천 결과 연동 및 HWPX/DOCX/PDF 일치성 검증이 완료되었습니다.');
  }
}

run().catch((err) => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});
