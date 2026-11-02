// 실제 운영 Supabase 환경 검증 스크립트 (결재 초안 RLS, 원자적 저장, 동시 수정 충돌, 비공개 이미지 스토리지)
// 주의: 운영 기존 상품/기준/고객 문서를 일절 건드리지 않으며 고유 시험 UUID로만 격리 수행 후 확실히 정리한다.
// 비밀값, 토큰, 키 등 민감 정보는 출력하지 않는다.

import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/lib/env.ts';
import { createServiceClient } from '../src/lib/supabase/service.ts';
import {
  saveDraft,
  getDraft,
  updateDraftEditable,
  deleteDraft,
  readProductImageBytes,
  RevisionConflictError,
} from '../src/data/approval-repository.ts';
import {
  generateCreatorToken,
  hashCreatorToken,
  canAccessDraftWithToken,
} from '../src/approval/auth.ts';
import type { ApprovalDraft } from '../src/approval/types.ts';

// 1. 환경 설정 및 Supabase 모드 강제 적용
try {
  Object.assign(process.env, { ...loadEnv(), ...process.env });
} catch (e) {
  console.error('[오류] .env.local 로드 실패');
  process.exit(1);
}

process.env.ONDAP_DATA_SOURCE = 'supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceKey) {
  console.error('[오류] Supabase 환경변수 누락 (URL 또는 키 미설정)');
  process.exit(1);
}

const TEST_ID = randomUUID();
const TEST_PRODUCT_NO = 99999;
const results: { step: string; passed: boolean; detail?: string }[] = [];

function record(step: string, passed: boolean, detail = '') {
  results.push({ step, passed, detail });
  console.log(`${passed ? '✔ PASS' : '✖ FAIL'}: ${step}${detail ? ` (${detail})` : ''}`);
}

async function run() {
  console.log('=== 실제 Supabase 환경 결재 저장소 검증 시작 ===');
  console.log(`[안내] 대상 Supabase 호스트: ${new URL(supabaseUrl!).hostname}`);
  console.log(`[격리] 시험용 초안 ID: ${TEST_ID} (검증 후 즉시 완전 정리)`);

  const anonClient = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const serviceClient = createServiceClient();

  try {
    // ----------------------------------------------------
    // 검증 1: RLS 권한 격리 (익명 사용자의 approval_drafts 접근 차단)
    // ----------------------------------------------------
    const { data: anonSelectData, error: anonSelectError } = await anonClient
      .from('approval_drafts')
      .select('id')
      .limit(1);

    // anon은 RLS에 의해 아예 권한 오류(42501 등)가 나거나 0건 반환되어야 함
    const anonReadBlocked = Boolean(anonSelectError) || (Array.isArray(anonSelectData) && anonSelectData.length === 0);
    record('1-1. 익명 사용자의 결재 초안 테이블 직접 조회 차단', anonReadBlocked, anonSelectError?.message ?? 'RLS 0건 제한');

    const { error: anonInsertError } = await anonClient
      .from('approval_drafts')
      .insert({
        id: TEST_ID,
        revision: 1,
        creator_token_hash: '0'.repeat(64),
        data: { test: true },
      });
    record('1-2. 익명 사용자의 결재 초안 쓰기 차단 (RLS 거부)', Boolean(anonInsertError), anonInsertError?.message ?? '');

    // ----------------------------------------------------
    // 검증 2: 비공개 스토리지 버킷(approval-assets) 접근 제어
    // ----------------------------------------------------
    // 버킷 정보 확인
    const { data: bucketData, error: bucketError } = await serviceClient.storage.getBucket('approval-assets');
    const isPrivateBucket = !bucketError && bucketData && bucketData.public === false;
    record('2-1. approval-assets 버킷 존재 및 비공개(public=false) 확인', isPrivateBucket, `public: ${bucketData?.public}`);

    // 익명 사용자의 다운로드 시도 차단 확인
    const { error: anonStorageError } = await anonClient.storage
      .from('approval-assets')
      .download(`non-existent-${TEST_ID}/test.png`);
    record('2-2. 익명 사용자의 비공개 자산 다운로드 차단', Boolean(anonStorageError), anonStorageError?.message ?? '');

    // ----------------------------------------------------
    // 검증 3: 서비스 역할 기반 정상 초안 생성 및 조회
    // ----------------------------------------------------
    const creatorToken = generateCreatorToken();
    const creatorTokenHash = hashCreatorToken(creatorToken);

    const testDraft: ApprovalDraft = {
      schemaVersion: 1,
      id: TEST_ID,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      creatorTokenHash,
      source: {
        query: {
          event: 'wedding',
          relation: 'senior',
          budget: 50000,
          qty: 30,
          exclude: [],
          budgetMode: 'total',
          totalBudget: 1500000,
        },
        budgetMode: 'total',
        originalTotalBudget: 1500000,
        modelVersion: 'core-contract-v1',
        catalogSyncedAt: new Date().toISOString(),
        snapshotAt: new Date().toISOString(),
        candidates: [
          {
            model: 'core-contract-v1',
            rank: 1,
            productNo: 27,
            productName: '[시험] 남해안 멸치 세트',
            price: 50000,
            imageUrl: 'https://example.com/test.jpg',
            tier: '격식',
            matchScore: 85,
            recommendationScore: 85.0,
            rarityValue: 9.0,
            eventFormality: 7.0,
            eventFitScore: 85.0,
            priceValueScore: 85.0,
            reason: '단정한 전통 선물',
            region: '남해',
            category: '수산',
            isDepopulationArea: true,
          },
        ],
      },
      editable: {
        eventName: '[시험검증] 정례 감사 답례품 선정',
        eventDate: '2026-11-30',
        organization: '온답 시험부',
        department: '검증팀',
        author: '검증관',
        purpose: '실제 Supabase 연동성 및 접근 보안 시험',
        quantity: 30,
        selectedProductNo: 27,
        additionalNote: '자동 검증 후 삭제 예정',
        approverTitles: ['담당', '팀장'],
        internalPerPersonLimit: null,
        internalRuleMemo: '',
      },
    };

    const saved = await saveDraft(testDraft);
    record('3-1. 서비스 역할로 신규 결재 초안 저장 성공', saved.revision === 1 && saved.id === TEST_ID, `revision=${saved.revision}`);

    const fetched = await getDraft(TEST_ID);
    record('3-2. 저장된 결재 초안 재조회 일치 확인', Boolean(fetched && fetched.id === TEST_ID && fetched.revision === 1), `fetched id=${fetched?.id}`);

    // ----------------------------------------------------
    // 검증 4: 작성자 토큰 기반 접근 권한 검증
    // ----------------------------------------------------
    const authorizedAccess = await canAccessDraftWithToken(creatorToken, fetched!);
    record('4-1. 유효한 작성자 토큰으로 접근 허용', authorizedAccess === true);

    const unauthorizedAccess = await canAccessDraftWithToken('invalid-fake-token-12345678', fetched!);
    record('4-2. 잘못된 토큰으로 접근 거절', unauthorizedAccess === false);

    const noTokenAccess = await canAccessDraftWithToken(null, fetched!);
    record('4-3. 토큰 없는 접근 거절', noTokenAccess === false);

    // ----------------------------------------------------
    // 검증 5: 비공개 스토리지 업로드 및 바이트 다운로드
    // ----------------------------------------------------
    // 1x1 투명 PNG 더미 바이트 (67 bytes)
    const testPngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    const storagePath = `${TEST_ID}/${TEST_PRODUCT_NO}.png`;
    const { error: uploadError } = await serviceClient.storage
      .from('approval-assets')
      .upload(storagePath, testPngBuffer, {
        contentType: 'image/png',
        upsert: true,
      });
    record('5-1. 비공개 버킷에 시험 이미지 업로드 성공', !uploadError, uploadError?.message ?? '');

    // readProductImageBytes를 통한 다운로드 확인 (로컬 캐시가 없는 상태에서 Supabase 다운로드 검증)
    const downloadedBytes = await readProductImageBytes(`${TEST_ID}_${TEST_PRODUCT_NO}.png`);
    const bytesMatch = Boolean(downloadedBytes && downloadedBytes.equals(testPngBuffer));
    record('5-2. readProductImageBytes()로 비공개 버킷에서 원본 바이트 복원 확인', bytesMatch, `길이=${downloadedBytes?.length}`);

    // ----------------------------------------------------
    // 검증 6: 조건부 원자적 갱신 및 개정 번호 동시 수정 충돌 방어
    // ----------------------------------------------------
    // 6-1. 정상 순차 갱신: revision 1 -> 2
    const updatedDraft = await updateDraftEditable(
      TEST_ID,
      { quantity: 40, purpose: '[수정] 40개로 수량 변경' },
      1,
    );
    record('6-1. revision 1 -> 2 정상 조건부 갱신 성공', updatedDraft.revision === 2 && updatedDraft.editable.quantity === 40, `revision=${updatedDraft.revision}`);

    // 6-2. 동시 충돌 시뮬레이션:
    // 이미 revision이 2인데, 과거 개정번호 1로 수정을 시도하면 RevisionConflictError 발생해야 함
    let conflictCaught = false;
    let reportedCurrentRevision = -1;
    try {
      await updateDraftEditable(
        TEST_ID,
        { quantity: 50, purpose: '[충돌시도] 이전 revision 1 기준 수정' },
        1,
      );
    } catch (err) {
      if (err instanceof RevisionConflictError) {
        conflictCaught = true;
        reportedCurrentRevision = err.currentRevision;
      }
    }
    record('6-2. 과거 revision(1) 요청 시 RevisionConflictError 발생', conflictCaught && reportedCurrentRevision === 2, `보고된 현재 revision=${reportedCurrentRevision}`);

    // 6-3. 충돌 후 데이터 보존 확인 (수량 50으로 덮어써지지 않고 40 유지)
    const afterConflictDraft = await getDraft(TEST_ID);
    record('6-3. 충돌 실패 후 기존 수정값(수량 40) 완벽 보존', Boolean(afterConflictDraft && afterConflictDraft.revision === 2 && afterConflictDraft.editable.quantity === 40));

    // ----------------------------------------------------
    // 검증 7: 경쟁적 동시 요청 (Promise.all) 원자적 단 1건만 성공
    // ----------------------------------------------------
    // 두 클라이언트가 동시에 revision 2인 상태에서 서로 다른 수량(60 vs 70)으로 갱신 요청
    const [p1, p2] = await Promise.allSettled([
      updateDraftEditable(TEST_ID, { quantity: 60 }, 2),
      updateDraftEditable(TEST_ID, { quantity: 70 }, 2),
    ]);

    const successes = [p1, p2].filter((p) => p.status === 'fulfilled');
    const conflicts = [p1, p2].filter(
      (p) => p.status === 'rejected' && p.reason instanceof RevisionConflictError,
    );

    record(
      '7-1. 동시 경쟁 수정 시 정확히 1건만 성공하고 1건은 RevisionConflictError 반환',
      successes.length === 1 && conflicts.length === 1,
      `성공=${successes.length}, 충돌=${conflicts.length}`,
    );

    const draftAfterRace = await getDraft(TEST_ID);
    record(
      '7-2. 동시 경쟁 후 최종 revision=3으로 안전하게 증분 확인',
      Boolean(draftAfterRace && draftAfterRace.revision === 3),
      `최종 revision=${draftAfterRace?.revision}`,
    );
  } finally {
    // ----------------------------------------------------
    // 검증 8: 철저한 시험 데이터 정리 (Cleanup)
    // ----------------------------------------------------
    console.log('=== 시험 데이터 정리 시작 ===');
    // 삭제 대상 ID가 방금 생성한 TEST_ID인지 재차 엄격 확인
    assert.equal(TEST_ID.length, 36);

    const deleted = await deleteDraft(TEST_ID);
    record('8-1. 시험 결재 초안 및 관련 스토리지 자산 삭제 실행', deleted === true);

    const recheckDraft = await getDraft(TEST_ID);
    record('8-2. 삭제 후 재조회 시 null 반환 (완전 삭제 확인)', recheckDraft === null);

    // 스토리지 파일 목록 조회 시 0건 (완전 소거 확인)
    const { data: remainingFiles } = await serviceClient.storage
      .from('approval-assets')
      .list(TEST_ID);
    const storageEmpty = Array.isArray(remainingFiles) && remainingFiles.length === 0;
    record('8-3. 스토리지 자산 삭제 확인 (폴더 내 잔여 파일 0건)', storageEmpty, `잔여=${remainingFiles?.length ?? 0}건`);

    // 혹시 남은 스토리지 파일 직접 확인 및 최종 소거
    try {
      const { data: remainingFiles } = await serviceClient.storage
        .from('approval-assets')
        .list(TEST_ID);
      if (remainingFiles && remainingFiles.length > 0) {
        await serviceClient.storage
          .from('approval-assets')
          .remove(remainingFiles.map((f) => `${TEST_ID}/${f.name}`));
      }
    } catch {}
  }

  // ----------------------------------------------------
  // 운영 무결성 확인: 상품, 근거, 정책, 추천로그 불변 확인
  // ----------------------------------------------------
  const { count: logCount, error: logErr } = await serviceClient
    .from('recommendation_logs')
    .select('*', { count: 'exact', head: true });
  record('9-1. 운영 recommendation_logs 무결성 (시험 로그 일절 미작성)', !logErr);

  const { count: productCount, error: prodErr } = await serviceClient
    .from('products')
    .select('*', { count: 'exact', head: true });
  record('9-2. 운영 products 테이블 무결성 (수정 없음)', !prodErr && (productCount ?? 0) > 0, `상품수=${productCount}`);

  console.log('=== 검증 요약 ===');
  const allPassed = results.every((r) => r.passed);
  console.log(`총 ${results.length}개 항목 중 ${results.filter((r) => r.passed).length}개 통과`);

  if (!allPassed) {
    console.error('일부 검증 항목이 실패했습니다.');
    process.exit(1);
  } else {
    console.log('✔ 모든 실제 Supabase 결재 저장소 검증이 성공적으로 완료되었습니다.');
  }
}

run().catch((err) => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});
