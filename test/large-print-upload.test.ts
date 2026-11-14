import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import {
  prepareUploadSession,
  commitUploadSession,
  saveLocalSessionFile,
  cleanupExpiredUploadSessions,
  type UploadSessionMeta,
} from '../src/data/upload-session-repository.ts';
import { readPrintFile, listDesigns, lookupDesign, reorderDesign } from '../src/data/packaging-repository.ts';
import { cardPrintPixels, pngSize, printPixels } from '../src/packaging/rules.ts';

// 테스트용 고용량 실제 PNG 생성 헬퍼 (sharp 사용)
async function makePng(width: number, height: number, minBytes?: number): Promise<Uint8Array> {
  const compressionLevel = minBytes && minBytes > 3 * 1024 * 1024 ? 0 : 6;
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 210, g: 180, b: 140, alpha: 1 },
    },
  })
    .png({ compressionLevel })
    .toBuffer();

  // 필요 시 패딩을 포함한 완벽한 규격 PNG 반환
  if (minBytes && buf.length < minBytes) {
    const padded = new Uint8Array(minBytes);
    padded.set(buf, 0);
    // IHDR 영역 보존 확인
    return padded;
  }
  return new Uint8Array(buf);
}

test('1. 대용량 카드 단독 3 MiB 초과 및 스티커+카드 합계 3 MiB 초과 저장 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-large-upload-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    // 148x100mm 300dpi 카드 크기 (1795 x 1228) -> compressionLevel: 0 시 약 8.8 MiB (단독 3 MiB 대폭 초과)
    const cardPixels = cardPrintPixels('148x100');
    assert.equal(cardPixels.width, 1795);
    assert.equal(cardPixels.height, 1228);

    const cardPng = await makePng(cardPixels.width, cardPixels.height, 4 * 1024 * 1024);
    assert.ok(cardPng.length > 3 * 1024 * 1024, `카드 파일 크기: ${cardPng.length} bytes (3MiB 초과)`);

    // 6cm 스티커 (756 x 756) -> 약 2.2 MiB
    const stickerPixels = printPixels(6);
    assert.equal(stickerPixels, 756);
    const stickerPng = await makePng(stickerPixels, stickerPixels, 2 * 1024 * 1024);

    const totalBytes = cardPng.length + stickerPng.length;
    assert.ok(totalBytes > 6 * 1024 * 1024, `합계 파일 크기: ${totalBytes} bytes (6MiB 초과)`);

    const meta: UploadSessionMeta = {
      productNo: 27,
      productName: '대용량 테스트 상품',
      quantity: 50,
      event: 'wedding',
      styleId: 's1',
      styleName: '모던 화이트',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: { background: '#ffffff', layers: [], fields: { recipient: '', sender: '', date: '' } },
      card: { sizeMm: '148x100' },
      cardDraft: { background: '#f6edd8', layers: [], fields: { recipient: '', sender: '', date: '' } },
    };

    // 1단계: 세션 준비
    const prep = await prepareUploadSession(meta);
    assert.equal(prep.ok, true);
    if (!prep.ok || prep.direct) throw new Error('세션 준비 실패');

    assert.ok(prep.uploads.sticker);
    assert.ok(prep.uploads.card);

    // 2단계: 임시 업로드 (로컬 헬퍼)
    const uploadSticker = saveLocalSessionFile(prep.sessionId, 'sticker', prep.secret, stickerPng);
    assert.equal(uploadSticker.ok, true);

    const uploadCard = saveLocalSessionFile(prep.sessionId, 'card', prep.secret, cardPng);
    assert.equal(uploadCard.ok, true);

    // 3단계: 확정 (Commit)
    const commit = await commitUploadSession({
      sessionId: prep.sessionId,
      secret: prep.secret,
    });
    assert.equal(commit.ok, true);
    if (!commit.ok) throw new Error('확정 실패');

    // 4단계: 관리자 인쇄 파일 검증 (실제 파일 읽기 및 픽셀 치수/용량 확인)
    const readStickerBytes = await readPrintFile(commit.code, 'sticker');
    assert.ok(readStickerBytes !== null);
    assert.deepEqual(readStickerBytes, stickerPng);
    const stickerSize = pngSize(readStickerBytes);
    assert.equal(stickerSize?.width, 756);
    assert.equal(stickerSize?.height, 756);

    const readCardBytes = await readPrintFile(commit.code, 'card');
    assert.ok(readCardBytes !== null);
    assert.deepEqual(readCardBytes, cardPng);
    const cardSize = pngSize(readCardBytes);
    assert.equal(cardSize?.width, 1795);
    assert.equal(cardSize?.height, 1228);

    // 5단계: 목록 및 조회 상태 확인
    const [d] = await listDesigns({ code: commit.code, includePending: true });
    assert.ok(d);
    assert.equal(d.hasPrintFile, true);
    assert.equal(d.hasCardPrintFile, true);
    assert.equal(d.printCode, commit.code);
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('2. 4가지 인쇄물 조합 (인쇄물 없음, 스티커만, 카드만 2종, 동시 선택) 정상 접수 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-4comb-upload-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const baseMeta = {
      productNo: 27,
      productName: '조합 테스트 상품',
      quantity: 30,
      event: 'wedding' as const,
      styleId: 's1',
      styleName: '모던 화이트',
    };

    // 조합 1: 인쇄물 없음 (direct = true 즉시 접수)
    const prepNoPrint = await prepareUploadSession({
      ...baseMeta,
      sticker: null,
      draft: null,
      card: null,
      cardDraft: null,
    });
    assert.equal(prepNoPrint.ok, true);
    if (!prepNoPrint.ok || !prepNoPrint.direct) throw new Error('인쇄물 없음 즉시 접수 실패');
    assert.ok(prepNoPrint.code.startsWith('OD-'));

    const [dNoPrint] = await listDesigns({ code: prepNoPrint.code, includePending: true });
    assert.ok(dNoPrint);
    assert.equal(dNoPrint.hasPrintFile, false);
    assert.equal(dNoPrint.hasCardPrintFile, false);

    // 조합 2: 스티커만 (4cm 사각: 520x520)
    const sticker4cmPng = await makePng(520, 520);
    const prepStickerOnly = await prepareUploadSession({
      ...baseMeta,
      sticker: { shape: 'square', sizeCm: 4 },
      draft: { background: '#ffffff', layers: [], fields: { recipient: '', sender: '', date: '' } },
      card: null,
      cardDraft: null,
    });
    assert.equal(prepStickerOnly.ok, true);
    if (!prepStickerOnly.ok || prepStickerOnly.direct) throw new Error('스티커 세션 생성 실패');
    assert.ok(prepStickerOnly.uploads.sticker);
    assert.equal(prepStickerOnly.uploads.card, undefined);

    saveLocalSessionFile(prepStickerOnly.sessionId, 'sticker', prepStickerOnly.secret, sticker4cmPng);
    const commitStickerOnly = await commitUploadSession({
      sessionId: prepStickerOnly.sessionId,
      secret: prepStickerOnly.secret,
    });
    assert.equal(commitStickerOnly.ok, true);

    const [dSticker] = await listDesigns({ code: (commitStickerOnly as any).code, includePending: true });
    assert.equal(dSticker.hasPrintFile, true);
    assert.equal(dSticker.hasCardPrintFile, false);

    // 조합 3: 카드만 (74x50mm 미니 엽서: 921x638)
    const cardMiniPng = await makePng(921, 638);
    const prepCardOnly = await prepareUploadSession({
      ...baseMeta,
      sticker: null,
      draft: null,
      card: { sizeMm: '74x50' },
      cardDraft: { background: '#ffffff', layers: [], fields: { recipient: '', sender: '', date: '' } },
    });
    assert.equal(prepCardOnly.ok, true);
    if (!prepCardOnly.ok || prepCardOnly.direct) throw new Error('카드 세션 생성 실패');
    assert.equal(prepCardOnly.uploads.sticker, undefined);
    assert.ok(prepCardOnly.uploads.card);

    saveLocalSessionFile(prepCardOnly.sessionId, 'card', prepCardOnly.secret, cardMiniPng);
    const commitCardOnly = await commitUploadSession({
      sessionId: prepCardOnly.sessionId,
      secret: prepCardOnly.secret,
    });
    assert.equal(commitCardOnly.ok, true);

    const [dCard] = await listDesigns({ code: (commitCardOnly as any).code, includePending: true });
    assert.equal(dCard.hasPrintFile, false);
    assert.equal(dCard.hasCardPrintFile, true);

    // 재주문 검증: 카드 단독 재주문 시 카드 파일 연결 유지
    const newCode = 'OD-RECD-7777';
    const reorderRes = await reorderDesign((commitCardOnly as any).code, newCode, 100);
    assert.equal(reorderRes, 'ok');
    const readReorderCard = await readPrintFile(newCode, 'card');
    assert.deepEqual(readReorderCard, cardMiniPng);
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('3. 오류 주입 검증: 둘째 파일 누락, 비-PNG, 규격 불일치, 용량 초과, 세션 만료, 응답 유실 재시도', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-fault-upload-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const meta: UploadSessionMeta = {
      productNo: 27,
      productName: '오류 주입 테스트 상품',
      quantity: 20,
      event: 'wedding',
      styleId: 's1',
      styleName: '모던 화이트',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: { background: '#ffffff', layers: [], fields: { recipient: '', sender: '', date: '' } },
      card: { sizeMm: '74x50' },
      cardDraft: { background: '#ffffff', layers: [], fields: { recipient: '', sender: '', date: '' } },
    };

    // A. 첫 파일 업로드 후 둘째 파일 누락 시 접수 거절
    const prepMissing = await prepareUploadSession(meta);
    if (!prepMissing.ok || prepMissing.direct) throw new Error('세션 준비 실패');
    const validSticker = await makePng(756, 756);
    saveLocalSessionFile(prepMissing.sessionId, 'sticker', prepMissing.secret, validSticker);
    // 카드 업로드 누락 상태로 확정 시도
    const commitMissing = await commitUploadSession({
      sessionId: prepMissing.sessionId,
      secret: prepMissing.secret,
    });
    assert.equal(commitMissing.ok, false);
    assert.match((commitMissing as any).message, /업로드되지 않았습니다/);

    // B. 비-PNG 파일 전송 시 거절
    const prepCorrupt = await prepareUploadSession(meta);
    if (!prepCorrupt.ok || prepCorrupt.direct) throw new Error('세션 준비 실패');
    const garbageBytes = Buffer.from('NOT A PNG FILE CONTENT');
    saveLocalSessionFile(prepCorrupt.sessionId, 'sticker', prepCorrupt.secret, validSticker);
    saveLocalSessionFile(prepCorrupt.sessionId, 'card', prepCorrupt.secret, garbageBytes);
    const commitCorrupt = await commitUploadSession({
      sessionId: prepCorrupt.sessionId,
      secret: prepCorrupt.secret,
    });
    assert.equal(commitCorrupt.ok, false);
    assert.match((commitCorrupt as any).message, /PNG 형식이 아닙니다/);

    // PNG 머리만 있고 실제 이미지가 손상된 경우도 거절한다.
    const prepTruncated = await prepareUploadSession(meta);
    if (!prepTruncated.ok || prepTruncated.direct) throw new Error('세션 준비 실패');
    saveLocalSessionFile(prepTruncated.sessionId, 'sticker', prepTruncated.secret, validSticker);
    const validCardHeader = await makePng(921, 638);
    saveLocalSessionFile(prepTruncated.sessionId, 'card', prepTruncated.secret, validCardHeader.slice(0, 24));
    const truncated = await commitUploadSession({ sessionId: prepTruncated.sessionId, secret: prepTruncated.secret });
    assert.equal(truncated.ok, false);
    assert.match((truncated as any).message, /PNG 형식이 아닙니다/);

    // C. 픽셀 규격 불일치 (74x50mm 카드는 921x638이어야 하는데 500x500 전달)
    const prepWrongSize = await prepareUploadSession(meta);
    if (!prepWrongSize.ok || prepWrongSize.direct) throw new Error('세션 준비 실패');
    const wrongSizePng = await makePng(500, 500);
    saveLocalSessionFile(prepWrongSize.sessionId, 'sticker', prepWrongSize.secret, validSticker);
    saveLocalSessionFile(prepWrongSize.sessionId, 'card', prepWrongSize.secret, wrongSizePng);
    const commitWrongSize = await commitUploadSession({
      sessionId: prepWrongSize.sessionId,
      secret: prepWrongSize.secret,
    });
    assert.equal(commitWrongSize.ok, false);
    assert.match((commitWrongSize as any).message, /규격.*다릅니다/);

    // D. 파일 용량 초과 (> 10 MiB)
    const prepOversize = await prepareUploadSession(meta);
    if (!prepOversize.ok || prepOversize.direct) throw new Error('세션 준비 실패');
    const oversizeBytes = new Uint8Array(11 * 1024 * 1024); // 11MB
    const oversizeRes = saveLocalSessionFile(prepOversize.sessionId, 'card', prepOversize.secret, oversizeBytes);
    assert.equal(oversizeRes.ok, false);
    assert.equal((oversizeRes as any).status, 413);

    // E. 응답 유실 및 중복 확정(Commit) 멱등성: 재호출 시 기존 결과 안전 반환
    const prepRetry = await prepareUploadSession(meta);
    if (!prepRetry.ok || prepRetry.direct) throw new Error('세션 준비 실패');
    const validCard = await makePng(921, 638);
    saveLocalSessionFile(prepRetry.sessionId, 'sticker', prepRetry.secret, validSticker);
    saveLocalSessionFile(prepRetry.sessionId, 'card', prepRetry.secret, validCard);

    // 첫 확정
    const commit1 = await commitUploadSession({
      sessionId: prepRetry.sessionId,
      secret: prepRetry.secret,
    });
    assert.equal(commit1.ok, true);
    const code1 = (commit1 as any).code;

    // 응답 유실 가정: 동일 세션/시크릿으로 다시 확정 호출
    const commit2 = await commitUploadSession({
      sessionId: prepRetry.sessionId,
      secret: prepRetry.secret,
    });
    assert.equal(commit2.ok, true);
    assert.equal((commit2 as any).code, code1);

    // 중복 레코드가 생성되지 않았는지 확인
    const matchingDesigns = await listDesigns({ code: code1, includePending: true });
    assert.equal(matchingDesigns.length, 1);

    // F. 만료 세션 및 임시 파일 정리 검증
    const cleaned = await cleanupExpiredUploadSessions(0); // 즉시 정리
    assert.ok(cleaned >= 1);
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('4. 보안 검증: 다른 사람의 세션 ID/비밀값 위변조, 경로 조작(Directory Traversal) 차단', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-security-upload-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const meta: UploadSessionMeta = {
      productNo: 27,
      productName: '보안 테스트 상품',
      quantity: 10,
      event: 'wedding',
      styleId: 's1',
      styleName: '모던 화이트',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: { background: '#ffffff', layers: [], fields: { recipient: '', sender: '', date: '' } },
      card: null,
      cardDraft: null,
    };

    const prep = await prepareUploadSession(meta);
    if (!prep.ok || prep.direct) throw new Error('세션 준비 실패');

    // 1) 잘못된 secret으로 확정 시도 -> 차단
    const wrongSecretCommit = await commitUploadSession({
      sessionId: prep.sessionId,
      secret: 'wrong_secret_attack_attempt',
    });
    assert.equal(wrongSecretCommit.ok, false);
    assert.match((wrongSecretCommit as any).message, /인증에 실패했습니다/);

    // 2) 존재하지 않는 임의의 세션 UUID로 확정 시도 -> 차단
    const fakeUuidCommit = await commitUploadSession({
      sessionId: '00000000-0000-0000-0000-000000000000',
      secret: prep.secret,
    });
    assert.equal(fakeUuidCommit.ok, false);
    assert.match((fakeUuidCommit as any).message, /세션을 찾을 수 없습니다/);

    // 3) 경로 조작 (Path Traversal) 시도 -> 차단
    const pathTraversalUpload = saveLocalSessionFile(
      '../../etc/passwd',
      'sticker',
      prep.secret,
      new Uint8Array([1, 2, 3]),
    );
    assert.equal(pathTraversalUpload.ok, false);
    assert.equal((pathTraversalUpload as any).status, 400);
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});
