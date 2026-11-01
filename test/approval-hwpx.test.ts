import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import * as fflate from 'fflate';
import { generateApprovalHwpx } from '../src/approval/hwpx.ts';
import { buildDocumentModel } from '../src/approval/calc.ts';
import { getCachedImagePath } from '../src/data/approval-repository.ts';
import type { ApprovalCandidate, ApprovalDraft } from '../src/approval/types.ts';

function createDummyDraft(overrides: Partial<ApprovalDraft> = {}): ApprovalDraft {
  const c1: ApprovalCandidate = {
    rank: 1,
    productNo: 301,
    productName: '나주 배 수제 양갱 세트',
    price: 32000,
    imageUrl: 'https://example.com/img1.png',
    tier: '격식',
    matchScore: 91,
    reason: '정갈하고 깊은 맛으로 감사의 뜻을 전하기에 적합',
    region: '나주',
    category: '식품',
    isDepopulationArea: true,
    story: '100% 나주 배 과즙을 사용한 전통 수제 양갱',
    attributesReviewed: true,
  };

  const c2: ApprovalCandidate = {
    rank: 2,
    productNo: 302,
    productName: '영광 모싯잎 송편 세트',
    price: 26000,
    imageUrl: 'https://example.com/img2.png',
    tier: '표준',
    matchScore: 85,
    reason: '구수한 풍미와 정성을 담은 전통 답례 떡',
    region: '영광',
    category: '식품',
    isDepopulationArea: false,
    story: '영광 법성포 모싯잎으로 빚은 전통 떡',
    attributesReviewed: true,
  };

  const base: ApprovalDraft = {
    schemaVersion: 1,
    id: 'f1e2d3c4-b5a6-4978-8123-abcdef012345',
    revision: 2,
    createdAt: '2026-10-31T09:00:00.000Z',
    updatedAt: '2026-10-31T09:30:00.000Z',
    source: {
      query: {
        event: 'wedding',
        relation: 'senior',
        budget: 35000,
        qty: 80,
        exclude: [],
        budgetMode: 'total',
        totalBudget: 2800000,
      },
      budgetMode: 'total',
      originalTotalBudget: 2800000,
      modelVersion: '2026.10',
      catalogSyncedAt: '2026-10-31T00:00:00.000Z',
      snapshotAt: '2026-10-31T09:00:00.000Z',
      candidates: [c1, c2],
    },
    editable: {
      eventName: '감사 답례 행사',
      eventDate: '2026-11-20',
      organization: '행정안전부',
      department: '공공서비스지원과',
      author: '이주무관',
      purpose: '상급자 및 외빈 감사 전달',
      quantity: 80,
      selectedProductNo: 301,
      additionalNote: '친환경 포장재 사용 요망',
      approverTitles: ['담당', '팀장', '과장'],
      internalPerPersonLimit: 50000,
      internalRuleMemo: '청탁금지법상 원활한 직무수행 가액 준수',
    },
  };

  return {
    ...base,
    ...overrides,
    source: { ...base.source, ...(overrides.source ?? {}) },
    editable: { ...base.editable, ...(overrides.editable ?? {}) },
  };
}

test('HWPX 생성: 정식 KS X 6101 OWPML 표준 패키지 구조 및 XML 무결성 검증', async () => {
  const draft = createDummyDraft();
  const model = buildDocumentModel(draft);
  const hwpxBytes = await generateApprovalHwpx(model);

  // 1. ZIP 매직 넘버 검증 (PK\x03\x04)
  assert.ok(hwpxBytes.length > 4000, 'HWPX 파일 크기가 최소 4KB 이상이어야 함');
  assert.equal(hwpxBytes[0], 0x50);
  assert.equal(hwpxBytes[1], 0x4b);
  assert.equal(hwpxBytes[2], 0x03);
  assert.equal(hwpxBytes[3], 0x04);

  // 2. ZIP 압축 해제 검증
  const unzipped = fflate.unzipSync(hwpxBytes);
  const entryNames = Object.keys(unzipped);

  // 필수 OWPML 표준 파일 확인
  assert.ok(entryNames.includes('mimetype'), 'mimetype 파일이 존재해야 함');
  assert.ok(entryNames.includes('version.xml'), 'version.xml 파일이 존재해야 함');
  assert.ok(entryNames.includes('META-INF/container.xml'), 'META-INF/container.xml 파일이 존재해야 함');
  assert.ok(entryNames.includes('Contents/content.hpf'), 'Contents/content.hpf 파일이 존재해야 함');
  assert.ok(entryNames.includes('Contents/header.xml'), 'Contents/header.xml 파일이 존재해야 함');
  assert.ok(entryNames.includes('Contents/section0.xml'), 'Contents/section0.xml 파일이 존재해야 함');

  // 3. mimetype 무압축(STORE) 및 식별자 확인
  const mimetypeText = new TextDecoder('utf-8').decode(unzipped['mimetype']);
  assert.equal(mimetypeText, 'application/hwp+zip');
  // ZIP 헤더에서 mimetype의 압축 방식이 0(STORE)인지 확인
  const compMethod = hwpxBytes[8] | (hwpxBytes[9] << 8);
  assert.equal(compMethod, 0, 'mimetype은 반드시 비압축(STORE, method 0)으로 패키지 최상단에 저장되어야 함');

  // 4. 본문(section0.xml) XML 태그 및 내용 검증
  const sectionXml = new TextDecoder('utf-8').decode(unzipped['Contents/section0.xml']);
  assert.ok(sectionXml.includes('답례품 선정 검토서'), '문서 제목이 포함되어야 함');
  assert.ok(sectionXml.includes('감사 답례 행사'), '행사명이 포함되어야 함');
  assert.ok(sectionXml.includes('나주 배 수제 양갱 세트'), '선정 상품명이 포함되어야 함');
  assert.ok(sectionXml.includes('[선택]'), '선택안 표기([선택])가 포함되어야 함');
  assert.ok(sectionXml.includes('1안(추천) [선택]'), '선택안 라벨이 포함되어야 함');
  assert.ok(sectionXml.includes('배송·추가 비용 및 부가세 포함 여부 별도 확인'), '추가비용 안내 문구가 포함되어야 함');
  assert.ok(sectionXml.includes('<hp:tbl'), '편집 가능한 표(<hp:tbl>)가 생성되어야 함');
  assert.ok(sectionXml.includes('<hp:tr'), '표 행(<hp:tr>)이 생성되어야 함');
  assert.ok(sectionXml.includes('<hp:tc'), '표 셀(<hp:tc>)이 생성되어야 함');

  // 5. 삭제 대상 항목이 section0.xml에 일절 나타나지 않아야 함
  assert.ok(!sectionXml.includes('법규 검토'), '법규 검토 항목이 문서에 없어야 함');
  assert.ok(!sectionXml.includes('선거 관련 규정'), '선거 관련 규정 항목이 문서에 없어야 함');
  assert.ok(!sectionXml.includes('계약 근거'), '계약 근거 항목이 문서에 없어야 함');
  assert.ok(!sectionXml.includes('식품 검수 상태'), '식품 검수 상태 항목이 문서에 없어야 함');
  assert.ok(!sectionXml.includes('지역 상생 의미'), '지역 상생 의미 항목이 문서에 없어야 함');
  assert.ok(!sectionXml.includes('생산자 정산 자료'), '생산자 정산 자료 항목이 문서에 없어야 함');

  // 6. 스타일(header.xml) 12pt 및 연회색 테두리 서식 검증
  const headerXml = new TextDecoder('utf-8').decode(unzipped['Contents/header.xml']);
  assert.ok(headerXml.includes('height="1200"'), '본문 12pt(1200 hwp unit) 스타일이 정의되어야 함');
  assert.ok(headerXml.includes('faceColor="#F2F2F2"'), '공문서 연회색 헤더(#F2F2F2) 테두리가 정의되어야 함');
});

test('HWPX 결재란 숨김: approverTitles가 빈 배열일 때 결재란 표 미포함', async () => {
  const draft = createDummyDraft({
    editable: {
      ...createDummyDraft().editable,
      approverTitles: [],
    },
  });
  const model = buildDocumentModel(draft);
  const hwpxBytes = await generateApprovalHwpx(model);
  const unzipped = fflate.unzipSync(hwpxBytes);
  const sectionXml = new TextDecoder('utf-8').decode(unzipped['Contents/section0.xml']);

  assert.ok(!sectionXml.includes('결재</hp:t>'), '직책을 모두 비웠을 때는 결재란이 포함되지 않아야 함');
});

test('HWPX 사진과 병합 셀: 유효한 그림만 포함하고 결재 서명 칸이 겹치지 않는다', async () => {
  const filename = 'codex-hwpx-test-301.png';
  const imagePath = getCachedImagePath(filename);
  await fs.mkdir(new URL('../data/approval-drafts/images/', import.meta.url), { recursive: true });
  await sharp({ create: { width: 16, height: 8, channels: 3, background: '#ff0000' } }).png().toFile(imagePath);
  try {
    const draft = createDummyDraft();
    draft.source.candidates[0].localImageFilename = filename;
    draft.source.candidates[1].localImageFilename = 'missing-codex-hwpx-test.png';
    const zip = fflate.unzipSync(await generateApprovalHwpx(buildDocumentModel(draft)));
    const xml = new TextDecoder().decode(zip['Contents/section0.xml']);
    const header = new TextDecoder().decode(zip['Contents/header.xml']);
    assert.ok(zip['BinData/image_301.png']);
    assert.ok(!zip['BinData/image_302.png']);
    assert.match(xml, /<hp:pic\b[\s\S]*?<hc:img binaryItemIDRef="img_301"/);
    assert.ok(!xml.includes('binaryItemIDRef="img_302"'));
    assert.ok(xml.includes('[사진 없음]'));
    assert.match(xml, /<hp:cellAddr colAddr="1" rowAddr="1"/);
    assert.match(header, /<hh:leftBorder type="SOLID"/);
  } finally {
    await fs.rm(imagePath, { force: true });
  }
});
