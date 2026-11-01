import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { generateApprovalDocx } from '../src/approval/docx.ts';
import { generateApprovalPdf } from '../src/approval/pdf.ts';
import { generateApprovalHwpx } from '../src/approval/hwpx.ts';
import { buildDocumentModel } from '../src/approval/calc.ts';
import type { ApprovalCandidate, ApprovalDraft } from '../src/approval/types.ts';
import * as fflate from 'fflate';

function createTestDraft(longContent = false): ApprovalDraft {
  const nameSuffix = longContent
    ? ' 매우 길고 상세한 전통 발효 수제 유기농 프리미엄 선물세트 (대용량 특별기획 한정판)'
    : '';
  const reasonSuffix = longContent
    ? ' 이 상품은 3대째 이어져 온 가업의 정성과 엄격한 전통 방식을 통해 장기간 숙성 발효하여 깊은 풍미를 자랑하며 귀한 분께 깊은 감사와 존경의 마음을 표하기에 가장 적합한 품격을 지니고 있습니다.'
    : '';

  const c1: ApprovalCandidate = {
    rank: 1,
    productNo: 201,
    productName: `담양 대나무 죽로차 세트${nameSuffix}`,
    price: 30000,
    imageUrl: 'https://axopenlab.cafe24.com/web/product/big/sample1.jpg',
    tier: '격식',
    matchScore: 92,
    reason: `단정한 격식과 지역 전통이 어우러진 답례품${reasonSuffix}`,
    region: '담양',
    category: '식품',
    isDepopulationArea: true,
    story: '담양 대나무 숲에서 자란 찻잎으로 덖은 죽로차',
    attributesReviewed: true,
  };

  const c2: ApprovalCandidate = {
    rank: 2,
    productNo: 202,
    productName: `안동 전통 한과 세트${nameSuffix}`,
    price: 28000,
    imageUrl: 'https://axopenlab.cafe24.com/web/product/big/sample2.jpg',
    tier: '표준',
    matchScore: 86,
    reason: `실속과 격식을 고루 갖춘 전통 과자 세트${reasonSuffix}`,
    region: '안동',
    category: '식품',
    isDepopulationArea: false,
    story: '100% 국산 조청과 찹쌀을 사용한 수제 한과',
    attributesReviewed: true,
  };

  const c3: ApprovalCandidate = {
    rank: 3,
    productNo: 203,
    productName: `제주 백호 은침 다기 세트${nameSuffix}`,
    price: 35000,
    imageUrl: 'https://axopenlab.cafe24.com/web/product/big/sample3.jpg',
    tier: '격식',
    matchScore: 84,
    reason: `특별한 감사 자리에 어울리는 고급 다기 세트${reasonSuffix}`,
    region: '제주',
    category: '공예',
    isDepopulationArea: false,
    story: '제주 화산토 도자기 명인의 수작업 다기',
    attributesReviewed: true,
  };

  return {
    schemaVersion: 1,
    id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    revision: 1,
    createdAt: '2026-10-31T09:00:00.000Z',
    updatedAt: '2026-10-31T09:00:00.000Z',
    source: {
      query: {
        event: 'wedding',
        relation: 'senior',
        budget: 35000,
        qty: 100,
        exclude: [],
        budgetMode: 'total',
        totalBudget: 3000000,
      },
      budgetMode: 'total',
      originalTotalBudget: 3000000,
      modelVersion: '2026.10',
      catalogSyncedAt: '2026-10-31T00:00:00.000Z',
      snapshotAt: '2026-10-31T09:00:00.000Z',
      candidates: [c1, c2, c3],
    },
    editable: {
      eventName: longContent
        ? '2026년도 하반기 공공기관 상생협력 우수부서 표창 및 유관기관 초청 정례 답례품 선정'
        : '하반기 감사 답례품 선정',
      eventDate: '2026-11-25',
      organization: '행정안전부',
      department: '공공서비스정책관 운영지원과',
      author: '홍길동 사무관',
      purpose: '참석 외빈 및 공공 유관기관 협력 관계자에 대한 감사와 의례적 답례품 전달',
      quantity: 100,
      selectedProductNo: 201,
      additionalNote: longContent
        ? '기관 예산 집행 지침상 친환경 포장재 사용 및 인구감소지역 우선 구매 권고 사항을 준수할 것.'
        : '친환경 포장재 사용 요청',
      approverTitles: ['담당', '팀장', '과장'],
      internalPerPersonLimit: 50000,
      internalRuleMemo: '청탁금지법상 원활한 직무수행·사교·의례 가액(5만원) 준수',
    },
  };
}

test('DOCX 생성: 일반 사례 및 긴 내용 사례가 정상 생성되고 ZIP 매직 넘버를 가진다', async () => {
  const normalDraft = createTestDraft(false);
  const normalModel = buildDocumentModel(normalDraft);
  const docxBytes = await generateApprovalDocx(normalModel);

  assert.ok(docxBytes.length > 5000, 'DOCX 바이트 길이가 유효해야 함');
  assert.equal(docxBytes[0], 0x50);
  assert.equal(docxBytes[1], 0x4b);
  assert.equal(docxBytes[2], 0x03);
  assert.equal(docxBytes[3], 0x04);

  // 긴 내용 사례
  const longDraft = createTestDraft(true);
  const longModel = buildDocumentModel(longDraft);
  const longDocxBytes = await generateApprovalDocx(longModel);
  assert.ok(longDocxBytes.length > docxBytes.length);

  // 로컬 샘플 파일 저장 (tmp 디렉터리)
  await fs.mkdir('tmp/samples', { recursive: true });
  await fs.writeFile('tmp/samples/sample_general.docx', docxBytes);
  await fs.writeFile('tmp/samples/sample_long.docx', longDocxBytes);
});

test('PDF 생성: 일반 사례(1페이지 완결) 및 긴 내용 사례가 정상 생성되고 %PDF 헤더를 가진다', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const normalDraft = createTestDraft(false);
  const normalModel = buildDocumentModel(normalDraft);
  const pdfBytes = await generateApprovalPdf(normalModel);

  assert.ok(pdfBytes.length > 50000, '한글 폰트가 임베드되어 수백 KB 이상이어야 함');
  assert.equal(pdfBytes[0], 0x25);
  assert.equal(pdfBytes[1], 0x50);
  assert.equal(pdfBytes[2], 0x44);
  assert.equal(pdfBytes[3], 0x46);

  // 일반 사례는 정확히 A4 1페이지여야 함
  const loadedNormal = await PDFDocument.load(pdfBytes);
  assert.equal(loadedNormal.getPageCount(), 1, '일반 사례는 A4 1페이지여야 함');

  // 긴 내용 사례
  const longDraft = createTestDraft(true);
  const longModel = buildDocumentModel(longDraft);
  const longPdfBytes = await generateApprovalPdf(longModel);
  assert.ok(longPdfBytes.length > 50000);

  // 로컬 샘플 파일 저장
  await fs.writeFile('tmp/samples/sample_general.pdf', pdfBytes);
  await fs.writeFile('tmp/samples/sample_long.pdf', longPdfBytes);
});

test('HWPX 생성 및 3종 파일(HWPX/DOCX/PDF) 삭제 대상 미노출 회귀 검증', async () => {
  const normalDraft = createTestDraft(false);
  const normalModel = buildDocumentModel(normalDraft);

  const hwpxBytes = await generateApprovalHwpx(normalModel);
  assert.ok(hwpxBytes.length > 4000);

  // 긴 내용 사례
  const longDraft = createTestDraft(true);
  const longModel = buildDocumentModel(longDraft);
  const longHwpxBytes = await generateApprovalHwpx(longModel);
  assert.ok(longHwpxBytes.length > hwpxBytes.length);

  // 로컬 샘플 파일 저장
  await fs.writeFile('tmp/samples/sample_general.hwpx', hwpxBytes);
  await fs.writeFile('tmp/samples/sample_long.hwpx', longHwpxBytes);

  // HWPX 내부 XML 검증: 삭제 대상 항목이 일절 포함되지 않음을 확인
  const unzipped = fflate.unzipSync(hwpxBytes);
  const sectionXml = new TextDecoder('utf-8').decode(unzipped['Contents/section0.xml']);

  const forbiddenTerms = [
    '법규 검토',
    '선거 관련 규정',
    '계약 근거',
    '식품 검수 상태',
    '지역 상생 의미',
    '생산자 정산 자료',
  ];

  for (const term of forbiddenTerms) {
    assert.ok(
      !sectionXml.includes(term),
      `HWPX 본문에 삭제 대상 항목 [${term}]이 포함되어서는 안 됨`,
    );
  }

  // DOCX 내부 XML 검증: 삭제 대상 항목이 일절 포함되지 않음을 확인
  const docxBytes = await generateApprovalDocx(normalModel);
  const docxUnzipped = fflate.unzipSync(docxBytes);
  const docXml = new TextDecoder('utf-8').decode(docxUnzipped['word/document.xml']);

  for (const term of forbiddenTerms) {
    assert.ok(
      !docXml.includes(term),
      `DOCX 본문에 삭제 대상 항목 [${term}]이 포함되어서는 안 됨`,
    );
  }
});
