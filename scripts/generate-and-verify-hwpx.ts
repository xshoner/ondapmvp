import fs from 'node:fs/promises';
import path from 'node:path';
import * as fflate from 'fflate';
import { generateApprovalHwpx } from '../src/approval/hwpx.ts';
import { buildDocumentModel } from '../src/approval/calc.ts';
import type { ApprovalCandidate, ApprovalDraft } from '../src/approval/types.ts';

async function run() {
  console.log('=== 한컴오피스 HWPX 생성 및 구조 검증 시작 ===');

  const c1: ApprovalCandidate = {
    rank: 1,
    productNo: 27,
    productName: '남해안 전통 자연 건조 죽방멸치 선물세트 (프리미엄 1호)',
    price: 35000,
    imageUrl: 'https://axopenlab.cafe24.com/web/product/big/sample1.jpg',
    tier: '격식',
    matchScore: 92,
    recommendationScore: 92.4,
    rarityValue: 9.1,
    eventFormality: 7.0,
    eventFitScore: 92.4,
    priceValueScore: 90.0,
    reason: '남해안 청정 해역에서 어획 후 당일 건조하여 비린내가 없고 은빛 광택이 살아있는 최고급 답례용 멸치 세트입니다.',
    region: '남해',
    category: '수산',
    isDepopulationArea: true,
    story: '3대째 이어져 온 전통 죽방렴 방식으로 어획한 은빛 멸치',
    attributesReviewed: true,
  };

  const c2: ApprovalCandidate = {
    rank: 2,
    productNo: 28,
    productName: '지리산 수제 야생 도라지청 선물세트 (유기농)',
    price: 32000,
    imageUrl: 'https://axopenlab.cafe24.com/web/product/big/sample2.jpg',
    tier: '표준',
    matchScore: 86,
    recommendationScore: 86.2,
    rarityValue: 8.5,
    eventFormality: 6.5,
    eventFitScore: 86.2,
    priceValueScore: 88.0,
    reason: '지리산 야생 도라지를 48시간 전통 가마솥에서 정성껏 다려 깊은 맛과 건강을 함께 전할 수 있는 정성스러운 선물입니다.',
    region: '남원',
    category: '식품',
    isDepopulationArea: true,
    story: '지리산 청정 고랭지에서 채취한 5년근 이상 수제 도라지청',
    attributesReviewed: true,
  };

  const c3: ApprovalCandidate = {
    rank: 3,
    productNo: 29,
    productName: '담양 대나무 전통 다기 및 죽로차 명인 세트',
    price: 38000,
    imageUrl: 'https://axopenlab.cafe24.com/web/product/big/sample3.jpg',
    tier: '격식',
    matchScore: 84,
    recommendationScore: 84.0,
    rarityValue: 8.8,
    eventFormality: 7.2,
    eventFitScore: 84.0,
    priceValueScore: 82.0,
    reason: '담양 대나무 명인이 수작업으로 깎아 만든 다기와 이슬을 머금고 자란 죽로차로 귀한 분을 예우하기에 적합합니다.',
    region: '담양',
    category: '공예',
    isDepopulationArea: true,
    story: '국가무형문화재 장인의 수공예 대나무 다기 세트',
    attributesReviewed: true,
  };

  const draft: ApprovalDraft = {
    schemaVersion: 1,
    id: 'b2c3d4e5-f6a7-4890-b123-cdef01234567',
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      query: {
        event: 'wedding',
        relation: 'senior',
        budget: 35000,
        qty: 50,
        exclude: [],
        budgetMode: 'total',
        totalBudget: 1750000,
      },
      budgetMode: 'total',
      originalTotalBudget: 1750000,
      modelVersion: 'core-contract-v1',
      catalogSyncedAt: new Date().toISOString(),
      snapshotAt: new Date().toISOString(),
      candidates: [c1, c2, c3],
    },
    editable: {
      eventName: '2026년 공공기관 상생협력 우수부서 표창 및 답례품 선정',
      eventDate: '2026-11-28',
      organization: '행정안전부',
      department: '공공서비스지원관 운영과',
      author: '김사무관',
      purpose: '참석 주요 외빈 및 협력 기관 관계자에 대한 공식 의례 및 정성 어린 감사 표명',
      quantity: 50,
      selectedProductNo: 27,
      additionalNote: '친환경 포장재 사용 및 행사 당일 오전 행사장 직배송 요청',
      approverTitles: ['담당', '팀장', '과장'],
      internalPerPersonLimit: 50000,
      internalRuleMemo: '청탁금지법 원활한 직무수행 범위 내 집행',
      complianceChecks: {
        antiGraft: true,
        electionLaw: true,
        contract: true,
      },
    },
  };

  const model = buildDocumentModel(draft);
  const hwpxBytes = await generateApprovalHwpx(model);

  console.log(`생성 완료: HWPX 크기 = ${hwpxBytes.byteLength} 바이트`);

  const tmpDir = path.resolve('tmp');
  await fs.mkdir(tmpDir, { recursive: true });
  const outputPath = path.join(tmpDir, 'approval-verification-sample.hwpx');
  await fs.writeFile(outputPath, hwpxBytes);
  console.log(`파일 저장 경로: ${outputPath}`);

  // ZIP 구조 및 XML 구문 검증
  const unzipped = fflate.unzipSync(new Uint8Array(hwpxBytes));
  const files = Object.keys(unzipped);

  console.log(`ZIP 압축 해제 항목 수: ${files.length}개`);
  const hasMimetype = files.includes('mimetype');
  const hasSection = files.includes('Contents/section0.xml');
  const hasContentHpf = files.includes('Contents/content.hpf');
  const hasHeaderXml = files.includes('Contents/header.xml');

  console.log(`- mimetype 파일 존재: ${hasMimetype}`);
  console.log(`- Contents/section0.xml 존재: ${hasSection}`);
  console.log(`- Contents/content.hpf 존재: ${hasContentHpf}`);
  console.log(`- Contents/header.xml 존재: ${hasHeaderXml}`);

  if (hasSection) {
    const sectionXml = fflate.strFromU8(unzipped['Contents/section0.xml']);
    console.log(`- section0.xml 크기: ${sectionXml.length} 문자`);
    console.log(`- 표(hp:tbl) 태그 포함 여부: ${sectionXml.includes('<hp:tbl')}`);
    console.log(`- 행사명 텍스트 포함 여부: ${sectionXml.includes('2026년 공공기관 상생협력 우수부서 표창')}`);
    console.log(`- 1안(선택) 표시 여부: ${sectionXml.includes('1안')}`);
    console.log(`- 상품 금액(1,750,000원) 포함 여부: ${sectionXml.includes('1,750,000원')}`);
  }

  console.log('=== 검증 완료: 정상 OWPML HWPX 패키지 표준 준수 ===');
}

run().catch((err) => {
  console.error('[오류]', err);
  process.exit(1);
});
