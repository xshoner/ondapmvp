// 실제 운영 Supabase 환경 결재 저장소 및 비공개 자산 보안 검증 스크립트
// - 운영 상품·기준·고객 문서를 일절 변경하지 않음 (시험 전/후 SHA-256 해시 대조로 무결성 입증)
// - 비공개 버킷 실제 업로드 파일 경로로 서비스 다운로드 성공 vs 익명 다운로드 거부(404 NoSuchKey) 명확 검증
// - 고유 시험 UUID 자산만 사용하고, 시험 데이터 정리 후 cacheNonce를 통한 실제 소거 재검증
// - 비밀값, 토큰, 키 등 민감 정보는 출력하지 않음.

import { randomUUID, createHash } from 'node:crypto';
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

async function captureOperationalSnapshots(client: any) {
  const { data: prods } = await client.from('products').select('product_no, price, name, display, selling').order('product_no');
  const prodsHash = createHash('sha256').update(JSON.stringify(prods ?? [])).digest('hex');

  const { data: policies } = await client.from('formality_policies').select('*').order('version');
  const policiesHash = createHash('sha256').update(JSON.stringify(policies ?? [])).digest('hex');

  const { data: evidence } = await client.from('product_evidence').select('*').order('product_no');
  const evidenceHash = createHash('sha256').update(JSON.stringify(evidence ?? [])).digest('hex');

  const { data: logs, count: logCount } = await client.from('recommendation_logs').select('id, created_at', { count: 'exact' }).order('id', { ascending: false }).limit(1);
  const latestLog = logs?.[0] ? `${logs[0].id}_${logs[0].created_at}` : 'none';

  const { count: draftCount } = await client.from('approval_drafts').select('id', { count: 'exact', head: true });

  return {
    prodsCount: prods?.length ?? 0,
    prodsHash,
    policiesCount: policies?.length ?? 0,
    policiesHash,
    evidenceCount: evidence?.length ?? 0,
    evidenceHash,
    logCount: logCount ?? 0,
    latestLog,
    draftCount: draftCount ?? 0,
  };
}

async function run() {
  console.log('=== 실제 Supabase 환경 결재 저장소 및 보안 검증 시작 ===');
  console.log(`[안내] 대상 Supabase 호스트: ${new URL(supabaseUrl!).hostname}`);
  console.log(`[격리] 시험용 초안 ID: ${TEST_ID} (검증 후 즉시 완전 정리)`);

  const anonClient = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const serviceClient = createServiceClient();

  // ----------------------------------------------------
  // 사전 운영 데이터 무결성 스냅샷 수집
  // ----------------------------------------------------
  const beforeSnapshot = await captureOperationalSnapshots(serviceClient);
  console.log(`[사전 스냅샷] 상품 ${beforeSnapshot.prodsCount}개(해시 ${beforeSnapshot.prodsHash.slice(0, 8)}), 정책 ${beforeSnapshot.policiesCount}개, 평가 ${beforeSnapshot.evidenceCount}개, 추천로그 ${beforeSnapshot.logCount}건, 결재초안 ${beforeSnapshot.draftCount}건`);

  try {
    // ----------------------------------------------------
    // 검증 1: RLS 권한 격리 (익명 사용자의 approval_drafts 접근 차단)
    // ----------------------------------------------------
    const { data: anonSelectData, error: anonSelectError } = await anonClient
      .from('approval_drafts')
      .select('id')
      .limit(1);

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
    // 검증 2: 비공개 스토리지 버킷(approval-assets) 실제 업로드 파일 권한 차단
    // ----------------------------------------------------
    const { data: bucketData, error: bucketError } = await serviceClient.storage.getBucket('approval-assets');
    const isPrivateBucket = !bucketError && bucketData && bucketData.public === false;
    record('2-1. approval-assets 버킷 존재 및 비공개(public=false) 확인', isPrivateBucket, `public: ${bucketData?.public}`);

    // 실제 1x1 투명 PNG 더미 바이트 (68 bytes) 업로드
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
    record('2-2. 서비스 권한으로 실제 시험 PNG 업로드 성공', !uploadError, uploadError?.message ?? '');

    // 동일하게 존재하는 실제 파일 경로에 대해:
    // 1) 서비스 권한으로 다운로드 성공 및 바이트 일치
    const serviceDownload = await serviceClient.storage
      .from('approval-assets')
      .download(storagePath);
    const serviceBytes = serviceDownload.data ? Buffer.from(await serviceDownload.data.arrayBuffer()) : null;
    const serviceDownloadSuccess = Boolean(serviceBytes && serviceBytes.equals(testPngBuffer));
    record('2-3. 서비스 권한으로 존재하는 파일 다운로드 성공 및 바이트 100% 일치', serviceDownloadSuccess, `길이=${serviceBytes?.length}`);

    // 2) 익명 권한으로 동일한 실제 파일 경로 다운로드 시도 -> RLS에 의해 거부 (Object not found / 404 NoSuchKey)
    const anonDownload = await anonClient.storage
      .from('approval-assets')
      .download(storagePath);
    const anonBlockedProperly = anonDownload.data === null && anonDownload.error !== null && (anonDownload.error as any).statusCode === '404';
    record('2-4. 익명 권한으로 실제 존재하는 파일 경로 다운로드 차단 (RLS 격리)', anonBlockedProperly, `에러코드=${(anonDownload.error as any)?.code}`);

    // 3) 익명 direct HTTP GET fetch 요청 시도 -> 400/404 차단
    const directAnonFetch = await fetch(`${supabaseUrl}/storage/v1/object/approval-assets/${storagePath}`, {
      headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey!}` },
    });
    record('2-5. 익명 HTTP GET 직접 요청 시 비공개 버킷 접근 차단', directAnonFetch.status >= 400, `HTTP 상태코드=${directAnonFetch.status}`);

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
    // 검증 5: readProductImageBytes를 통한 원본 바이트 복원 확인
    // ----------------------------------------------------
    const downloadedBytes = await readProductImageBytes(`${TEST_ID}_${TEST_PRODUCT_NO}.png`);
    const bytesMatch = Boolean(downloadedBytes && downloadedBytes.equals(testPngBuffer));
    record('5-1. readProductImageBytes()로 비공개 버킷에서 원본 바이트 복원 확인', bytesMatch, `길이=${downloadedBytes?.length}`);

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

    // 6-2. 과거 revision(1) 요청 시 RevisionConflictError 발생
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

    // 6-3. 충돌 후 데이터 보존 확인
    const afterConflictDraft = await getDraft(TEST_ID);
    record('6-3. 충돌 실패 후 기존 수정값(수량 40) 완벽 보존', Boolean(afterConflictDraft && afterConflictDraft.revision === 2 && afterConflictDraft.editable.quantity === 40));

    // ----------------------------------------------------
    // 검증 7: 경쟁적 동시 요청 (Promise.all) 원자적 단 1건만 성공
    // ----------------------------------------------------
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
    // 검증 8: 철저한 시험 데이터 정리 (Cleanup) 및 서비스 권한 재조회
    // ----------------------------------------------------
    console.log('=== 시험 데이터 정리 시작 ===');
    assert.equal(TEST_ID.length, 36);

    const deleted = await deleteDraft(TEST_ID);
    record('8-1. 시험 결재 초안 및 관련 스토리지 자산 삭제 실행', deleted === true);

    const recheckDraft = await getDraft(TEST_ID);
    record('8-2. 삭제 후 결재 초안 재조회 시 null 반환 (완전 삭제 확인)', recheckDraft === null);

    // 스토리지 파일 목록 조회 시 0건 (완전 소거 확인)
    const { data: remainingFiles } = await serviceClient.storage
      .from('approval-assets')
      .list(TEST_ID);
    const storageEmpty = Array.isArray(remainingFiles) && remainingFiles.length === 0;
    record('8-3. 스토리지 폴더 재조회 시 잔여 파일 0건 확인', storageEmpty, `잔여=${remainingFiles?.length ?? 0}건`);

    // 서비스 권한으로 캐시 무효화 후 실제 파일 다운로드 재조회 시 Object not found (에러 발생 확인, null과 구분)
    const recheckDownload = await serviceClient.storage
      .from('approval-assets')
      .download(`${TEST_ID}/${TEST_PRODUCT_NO}.png`, { cacheNonce: String(Date.now()) });
    const downloadFailedProperly = recheckDownload.data === null && recheckDownload.error !== null && (recheckDownload.error as any).statusCode === '404';
    record('8-4. 삭제 후 서비스 권한 파일 직접 재조회 시 404 NoSuchKey 오류 반환 (삭제 실증)', downloadFailedProperly, `에러코드=${(recheckDownload.error as any)?.code}`);
  }

  // ----------------------------------------------------
  // 검증 9: 운영 데이터 무결성 전/후 SHA-256 해시 엄격 대조
  // ----------------------------------------------------
  console.log('=== 운영 데이터 무결성 전/후 대조 검증 ===');
  const afterSnapshot = await captureOperationalSnapshots(serviceClient);

  const prodUnchanged = beforeSnapshot.prodsCount === afterSnapshot.prodsCount && beforeSnapshot.prodsHash === afterSnapshot.prodsHash;
  record('9-1. 운영 products 테이블 전/후 SHA-256 해시 일치 (상품 무결성)', prodUnchanged, `상품 ${afterSnapshot.prodsCount}개`);

  const policiesUnchanged = beforeSnapshot.policiesCount === afterSnapshot.policiesCount && beforeSnapshot.policiesHash === afterSnapshot.policiesHash;
  record('9-2. 운영 formality_policies 테이블 전/후 SHA-256 해시 일치 (정책 무결성)', policiesUnchanged, `정책 ${afterSnapshot.policiesCount}개`);

  const evidenceUnchanged = beforeSnapshot.evidenceCount === afterSnapshot.evidenceCount && beforeSnapshot.evidenceHash === afterSnapshot.evidenceHash;
  record('9-3. 운영 product_evidence 테이블 전/후 SHA-256 해시 일치 (평가 무결성)', evidenceUnchanged, `평가 ${afterSnapshot.evidenceCount}개`);

  const logsUnchanged = beforeSnapshot.logCount === afterSnapshot.logCount && beforeSnapshot.latestLog === afterSnapshot.latestLog;
  record('9-4. 운영 recommendation_logs 전/후 건수 및 최신ID 일치 (로그 오염 0건)', logsUnchanged, `총 로그 ${afterSnapshot.logCount}건`);

  const draftsUnchanged = beforeSnapshot.draftCount === afterSnapshot.draftCount;
  record('9-5. 운영 approval_drafts 테이블 잔여 행 없음 (시험 데이터 완전 소거)', draftsUnchanged, `현재 초안 ${afterSnapshot.draftCount}건`);

  console.log('=== 검증 요약 ===');
  const allPassed = results.every((r) => r.passed);
  console.log(`총 ${results.length}개 항목 중 ${results.filter((r) => r.passed).length}개 통과`);

  if (!allPassed) {
    console.error('일부 검증 항목이 실패했습니다.');
    process.exit(1);
  } else {
    console.log('✔ 모든 실제 Supabase 결재 저장소 보안 및 무결성 검증이 완벽하게 통과되었습니다.');
  }
}

run().catch((err) => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});
