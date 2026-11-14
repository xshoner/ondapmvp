// 포장 디자인 대용량 인쇄 파일(스티커·카드) 업로드 세션 및 무결성 검증 저장소.
// 서버리스 메모리/요청 본문 한도(4.5MB)를 초과하지 않도록 브라우저가 임시 저장소에 직접 올리고
// 서버에서 파일 무결성(PNG 시그니처, 픽셀 규격, 용량) 검증 후 원자적으로 확정한다.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, renameSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../lib/paths.ts';
import { dataSource } from '../lib/supabase/env.ts';
import { createServiceClient } from '../lib/supabase/service.ts';
import type { EventType } from '../engine/types.ts';
import type { CardSpec, Design, DesignDraft, StickerSpec } from '../packaging/types.ts';
import {
  MAX_CARD_PRINT_BYTES,
  MAX_STICKER_PRINT_BYTES,
  cardPrintPixels,
  generateDesignCode,
  pngSize,
  printPixels,
  sanitizeCard,
  sanitizeSticker,
} from '../packaging/rules.ts';

const PRINT_BUCKET = 'design-files';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10분 만료

export interface UploadSessionMeta {
  productNo: number;
  productName: string;
  quantity: number;
  event: EventType | null;
  styleId: string;
  styleName: string;
  sticker: StickerSpec | null;
  draft: DesignDraft | null;
  card: CardSpec | null;
  cardDraft: DesignDraft | null;
}

export interface ExpectedFileSpec {
  path: string;
  maxBytes: number;
  width: number;
  height: number;
}

export interface UploadSessionRecord {
  id: string; // sessionId (UUID)
  code: string; // OD-XXXX-XXXX
  secretHash: string; // SHA-256 of secret
  meta: UploadSessionMeta;
  filesExpected: {
    sticker?: ExpectedFileSpec;
    card?: ExpectedFileSpec;
  };
  status: 'pending' | 'completed' | 'failed' | 'expired';
  createdAt: string;
  expiresAt: string;
}

export type PrepareUploadResult =
  | { ok: true; direct: true; code: string }
  | {
      ok: true;
      direct: false;
      mode: 'supabase' | 'local';
      sessionId: string;
      secret: string;
      code: string;
      expiresAt: string;
      uploads: {
        sticker?: {
          signedUrl: string;
          token: string;
          path: string;
          maxBytes: number;
          expected: { width: number; height: number };
        };
        card?: {
          signedUrl: string;
          token: string;
          path: string;
          maxBytes: number;
          expected: { width: number; height: number };
        };
      };
    }
  | { ok: false; message: string };

export type CommitUploadResult = { ok: true; code: string } | { ok: false; message: string; uncertain?: boolean };

// ---------- 로컬 저장소 헬퍼 ----------

const currentDataDir = () => process.env.ONDAP_TEST_DATA_DIR || dataDir;
const sessionsFile = () => join(currentDataDir(), 'upload-sessions.json');
const printDir = () => join(currentDataDir(), 'design-files');
const tmpDir = () => join(printDir(), 'tmp');

function readLocalSessions(): UploadSessionRecord[] {
  const f = sessionsFile();
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as UploadSessionRecord[]) : [];
}

function writeLocalSessions(sessions: UploadSessionRecord[]): void {
  writeFileSync(sessionsFile(), JSON.stringify(sessions, null, 2) + '\n');
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function verifySecretConstantTime(secret: string, expectedHash: string): boolean {
  try {
    const computed = hashSecret(secret);
    const bufA = Buffer.from(computed, 'hex');
    const bufB = Buffer.from(expectedHash, 'hex');
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

async function validPng(bytes: Uint8Array): Promise<boolean> {
  try {
    const sharp = (await import('sharp')).default;
    const image = sharp(bytes, { limitInputPixels: 4_000_000, failOn: 'error' });
    if ((await image.metadata()).format !== 'png') return false;
    await image.stats();
    return true;
  } catch {
    return false;
  }
}

// ---------- 1. 업로드 세션 생성 (준비) ----------

export async function prepareUploadSession(meta: UploadSessionMeta): Promise<PrepareUploadResult> {
  const sticker = sanitizeSticker(meta.sticker);
  const card = sanitizeCard(meta.card);
  const needSticker = Boolean(sticker);
  const needCard = Boolean(card);

  // 인쇄물이 없는 경우 파일 업로드 없이 즉시 접수 가능
  if (!needSticker && !needCard) {
    const { createDesign } = await import('./packaging-repository.ts');
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateDesignCode();
      const res = await createDesign(
        {
          code,
          productNo: meta.productNo,
          productName: meta.productName,
          quantity: meta.quantity,
          event: meta.event,
          styleId: meta.styleId,
          styleName: meta.styleName,
          sticker: null,
          draft: null,
          card: null,
          cardDraft: null,
        },
        null,
        null,
      );
      if (res === 'ok') return { ok: true, direct: true, code };
    }
    return { ok: false, message: '코드를 발급하지 못했습니다. 다시 시도해 주세요.' };
  }

  const sessionId = randomUUID();
  const secret = randomBytes(32).toString('hex');
  const secretHash = hashSecret(secret);
  const code = generateDesignCode();
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();

  const filesExpected: UploadSessionRecord['filesExpected'] = {};
  if (needSticker && sticker) {
    const pixels = printPixels(sticker.sizeCm);
    filesExpected.sticker = {
      path: `tmp/${sessionId}/sticker.png`,
      maxBytes: MAX_STICKER_PRINT_BYTES,
      width: pixels,
      height: pixels,
    };
  }
  if (needCard && card) {
    const dims = cardPrintPixels(card.sizeMm);
    filesExpected.card = {
      path: `tmp/${sessionId}/card.png`,
      maxBytes: MAX_CARD_PRINT_BYTES,
      width: dims.width,
      height: dims.height,
    };
  }

  // 1) 로컬 모드
  if (dataSource() === 'local') {
    const sessions = readLocalSessions();
    sessions.push({
      id: sessionId,
      code,
      secretHash,
      meta,
      filesExpected,
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt,
    });
    writeLocalSessions(sessions);

    mkdirSync(join(tmpDir(), sessionId), { recursive: true });

    return {
      ok: true,
      direct: false,
      mode: 'local',
      sessionId,
      secret,
      code,
      expiresAt,
      uploads: {
        ...(filesExpected.sticker ? {
          sticker: {
            signedUrl: `/api/packaging/upload?session=${sessionId}&item=sticker&secret=${secret}`,
            token: secret,
            path: filesExpected.sticker.path,
            maxBytes: filesExpected.sticker.maxBytes,
            expected: { width: filesExpected.sticker.width, height: filesExpected.sticker.height },
          },
        } : {}),
        ...(filesExpected.card ? {
          card: {
            signedUrl: `/api/packaging/upload?session=${sessionId}&item=card&secret=${secret}`,
            token: secret,
            path: filesExpected.card.path,
            maxBytes: filesExpected.card.maxBytes,
            expected: { width: filesExpected.card.width, height: filesExpected.card.height },
          },
        } : {}),
      },
    };
  }

  // 2) Supabase 모드
  const db = createServiceClient();
  const uploadsOut: PrepareUploadResult = {
    ok: true,
    direct: false,
    mode: 'supabase',
    sessionId,
    secret,
    code,
    expiresAt,
    uploads: {},
  };

  if (filesExpected.sticker) {
    const { data: signData, error: signErr } = await db.storage
      .from(PRINT_BUCKET)
      .createSignedUploadUrl(filesExpected.sticker.path, { upsert: false });
    if (signErr || !signData) {
      console.error('[업로드 세션] 스티커 서명 URL 발급 실패:', signErr);
      return { ok: false, message: '업로드 경로를 생성하지 못했습니다.' };
    }
    uploadsOut.uploads.sticker = {
      signedUrl: signData.signedUrl,
      token: signData.token,
      path: filesExpected.sticker.path,
      maxBytes: filesExpected.sticker.maxBytes,
      expected: { width: filesExpected.sticker.width, height: filesExpected.sticker.height },
    };
  }

  if (filesExpected.card) {
    const { data: signData, error: signErr } = await db.storage
      .from(PRINT_BUCKET)
      .createSignedUploadUrl(filesExpected.card.path, { upsert: false });
    if (signErr || !signData) {
      console.error('[업로드 세션] 카드 서명 URL 발급 실패:', signErr);
      return { ok: false, message: '카드 업로드 경로를 생성하지 못했습니다.' };
    }
    uploadsOut.uploads.card = {
      signedUrl: signData.signedUrl,
      token: signData.token,
      path: filesExpected.card.path,
      maxBytes: filesExpected.card.maxBytes,
      expected: { width: filesExpected.card.width, height: filesExpected.card.height },
    };
  }

  const { error: insertErr } = await db.from('design_upload_sessions').insert({
    id: sessionId,
    code,
    secret_hash: secretHash,
    meta,
    files_expected: filesExpected,
    status: 'pending',
    expires_at: expiresAt,
  });

  if (insertErr) {
    console.error('[업로드 세션] 세션 DB 등록 실패:', insertErr);
    return { ok: false, message: '업로드 세션을 시작하지 못했습니다.' };
  }

  return uploadsOut;
}

// ---------- 2. 세션 단일 파일 수신 (로컬 모드 API용) ----------

export function saveLocalSessionFile(
  sessionId: string,
  item: 'sticker' | 'card',
  secret: string,
  fileBytes: Uint8Array,
): { ok: true } | { ok: false; status: number; message: string } {
  if (!UUID_RE.test(sessionId)) return { ok: false, status: 400, message: '잘못된 세션 식별자입니다.' };
  const sessions = readLocalSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false, status: 404, message: '세션을 찾을 수 없습니다.' };
  if (!verifySecretConstantTime(secret, session.secretHash)) {
    return { ok: false, status: 403, message: '인증에 실패했습니다.' };
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    return { ok: false, status: 410, message: '세션이 만료되었습니다.' };
  }
  const spec = session.filesExpected[item];
  if (!spec) return { ok: false, status: 400, message: '해당 인쇄물은 요청되지 않았습니다.' };
  if (fileBytes.length > spec.maxBytes) {
    return { ok: false, status: 413, message: `파일 용량이 제한(${Math.round(spec.maxBytes / (1024 * 1024))}MB)을 초과했습니다.` };
  }

  const dir = join(tmpDir(), sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${item}.png`), fileBytes);
  return { ok: true };
}

// ---------- 3. 업로드 검증 및 접수 확정 (Commit) ----------

export async function commitUploadSession(input: {
  sessionId: string;
  secret: string;
}): Promise<CommitUploadResult> {
  const { sessionId, secret } = input;
  if (!UUID_RE.test(sessionId) || !secret) {
    return { ok: false, message: '유효하지 않은 접수 요청입니다.' };
  }

  // 1) 로컬 모드 확정
  if (dataSource() === 'local') {
    const sessions = readLocalSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false, message: '세션을 찾을 수 없습니다.' };
    if (!verifySecretConstantTime(secret, session.secretHash)) {
      return { ok: false, message: '인증에 실패했습니다.' };
    }

    // 멱등성: 이미 완료된 세션이면 기존 코드 즉시 반환 (응답 유실 복구)
    if (session.status === 'completed') {
      return { ok: true, code: session.code };
    }
    if (session.status === 'failed') {
      return { ok: false, message: '실패 처리된 세션입니다. 새로 접수해 주세요.' };
    }
    if (session.status === 'expired' || new Date(session.expiresAt).getTime() < Date.now()) {
      session.status = 'expired';
      writeLocalSessions(sessions);
      return { ok: false, message: '업로드 세션이 만료되었습니다. 새로 접수해 주세요.' };
    }

    // 파일 무결성 및 규격 검증
    const dir = join(tmpDir(), sessionId);
    for (const [itemKey, spec] of Object.entries(session.filesExpected)) {
      if (!spec) continue;
      const filePath = join(dir, `${itemKey}.png`);
      if (!existsSync(filePath)) {
        session.status = 'failed';
        writeLocalSessions(sessions);
        return { ok: false, message: `${itemKey === 'sticker' ? '스티커' : '카드'} 인쇄 파일이 업로드되지 않았습니다.` };
      }
      const bytes = new Uint8Array(readFileSync(filePath));
      if (bytes.length > spec.maxBytes) {
        session.status = 'failed';
        writeLocalSessions(sessions);
        return { ok: false, message: `${itemKey === 'sticker' ? '스티커' : '카드'} 인쇄 파일 용량이 제한을 초과했습니다.` };
      }
      const size = pngSize(bytes);
      if (!size || !(await validPng(bytes))) {
        session.status = 'failed';
        writeLocalSessions(sessions);
        return { ok: false, message: `${itemKey === 'sticker' ? '스티커' : '카드'} 파일이 올바른 PNG 형식이 아닙니다.` };
      }
      if (Math.abs(size.width - spec.width) > 2 || Math.abs(size.height - spec.height) > 2) {
        session.status = 'failed';
        writeLocalSessions(sessions);
        return {
          ok: false,
          message: `${itemKey === 'sticker' ? '스티커' : '카드'} 규격(${size.width}×${size.height}px)이 기준(${spec.width}×${spec.height}px)과 다릅니다.`,
        };
      }
    }

    // 검증 통과: 정식 파일명으로 이동 및 접수 완료
    mkdirSync(printDir(), { recursive: true });
    let hasPrint = false;
    let hasCardPrint = false;

    if (session.filesExpected.sticker) {
      const src = join(dir, 'sticker.png');
      const dst = join(printDir(), `${session.code}.png`);
      renameSync(src, dst);
      hasPrint = true;
    }
    if (session.filesExpected.card) {
      const src = join(dir, 'card.png');
      const dst = join(printDir(), `${session.code}-card.png`);
      renameSync(src, dst);
      hasCardPrint = true;
    }

    // 임시 디렉토리 정리
    rmSync(dir, { recursive: true, force: true });

    // designs.json 반영
    const designsFile = join(currentDataDir(), 'designs.json');
    const allDesigns: Design[] = existsSync(designsFile) ? JSON.parse(readFileSync(designsFile, 'utf8')) : [];
    const nowIso = new Date().toISOString();
    allDesigns.unshift({
      code: session.code,
      createdAt: nowIso,
      productNo: session.meta.productNo,
      productName: session.meta.productName,
      quantity: session.meta.quantity,
      event: session.meta.event,
      styleId: session.meta.styleId || '',
      styleName: session.meta.styleName,
      sticker: session.meta.sticker,
      draft: session.meta.draft,
      card: session.meta.card,
      cardDraft: session.meta.cardDraft,
      hasPrintFile: hasPrint,
      hasCardPrintFile: hasCardPrint,
      printCode: (hasPrint || hasCardPrint) ? session.code : null,
      sourceCode: null,
      status: 'pending',
      statusChangedAt: nowIso,
      orderNo: null,
      memo: '',
    });
    writeFileSync(designsFile, JSON.stringify(allDesigns, null, 2) + '\n');

    session.status = 'completed';
    writeLocalSessions(sessions);
    return { ok: true, code: session.code };
  }

  // 2) Supabase 모드 확정
  const db = createServiceClient();
  const { data: sessionRow, error: fetchErr } = await db
    .from('design_upload_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (fetchErr) return { ok: false, uncertain: true, message: '접수 상태를 확인하지 못했습니다.' };
  if (!sessionRow) {
    return { ok: false, message: '세션을 찾을 수 없습니다.' };
  }

  if (!verifySecretConstantTime(secret, sessionRow.secret_hash)) {
    return { ok: false, message: '인증에 실패했습니다.' };
  }

  if (sessionRow.status === 'completed') {
    return { ok: true, code: sessionRow.code };
  }
  if (sessionRow.status === 'failed') {
    return { ok: false, message: '실패 처리된 세션입니다. 새로 접수해 주세요.' };
  }
  if (sessionRow.status === 'expired' || new Date(sessionRow.expires_at).getTime() < Date.now()) {
    await db.from('design_upload_sessions').update({ status: 'expired' }).eq('id', sessionId).eq('status', 'pending');
    return { ok: false, message: '업로드 세션이 만료되었습니다. 새로 접수해 주세요.' };
  }

  const filesExpected = (sessionRow.files_expected ?? {}) as UploadSessionRecord['filesExpected'];
  const downloadedFiles: { itemKey: string; path: string; bytes: Uint8Array; targetName: string }[] = [];

  for (const [itemKey, spec] of Object.entries(filesExpected)) {
    if (!spec) continue;
    const { data: blob, error: dlErr } = await db.storage.from(PRINT_BUCKET).download(spec.path);
    if (dlErr || !blob) {
      console.warn(`[업로드 세션] 임시 파일 다운로드 실패 (${spec.path}):`, dlErr);
      return { ok: false, message: `${itemKey === 'sticker' ? '스티커' : '카드'} 인쇄 파일이 업로드되지 않았습니다.` };
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > spec.maxBytes) {
      return { ok: false, message: `${itemKey === 'sticker' ? '스티커' : '카드'} 인쇄 파일 용량이 제한을 초과했습니다.` };
    }
    const size = pngSize(bytes);
    if (!size || !(await validPng(bytes))) {
      return { ok: false, message: `${itemKey === 'sticker' ? '스티커' : '카드'} 파일이 올바른 PNG 형식이 아닙니다.` };
    }
    if (Math.abs(size.width - spec.width) > 2 || Math.abs(size.height - spec.height) > 2) {
      return {
        ok: false,
        message: `${itemKey === 'sticker' ? '스티커' : '카드'} 규격(${size.width}×${size.height}px)이 기준(${spec.width}×${spec.height}px)과 다릅니다.`,
      };
    }
    const targetName = itemKey === 'card' ? `${sessionRow.code}-card.png` : `${sessionRow.code}.png`;
    downloadedFiles.push({ itemKey, path: spec.path, bytes, targetName });
  }

  // 임시 파일은 확정이 불확실해도 재시도할 수 있도록 접수 완료까지 유지한다.
  for (const f of downloadedFiles) {
    const { error: uploadErr } = await db.storage.from(PRINT_BUCKET).upload(f.targetName, f.bytes, { contentType: 'image/png', upsert: false });
    if (uploadErr) {
      // 응답 유실이나 동시 재시도라면 동일한 파일만 재사용한다.
      const { data: existing } = await db.storage.from(PRINT_BUCKET).download(f.targetName);
      if (!existing || !Buffer.from(await existing.arrayBuffer()).equals(Buffer.from(f.bytes))) {
        return { ok: false, uncertain: true, message: '인쇄 파일 저장을 확인하지 못했습니다. 다시 시도해 주세요.' };
      }
    }
  }

  const { data: code, error: insertErr } = await db.rpc('finish_design_upload', { p_session_id: sessionId });
  if (insertErr || code !== sessionRow.code) {
    console.error('[업로드 세션] designs 등록 실패:', insertErr?.message);
    return { ok: false, uncertain: true, message: '디자인 접수 정보를 확인하지 못했습니다.' };
  }
  return { ok: true, code };
}

// ---------- 4. 만료된 임시 세션 및 파일 정리 (Cleanup) ----------

export async function cleanupExpiredUploadSessions(staleMinutes = 120): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
  let cleanedCount = 0;

  if (dataSource() === 'local') {
    const sessions = readLocalSessions();
    const remaining: UploadSessionRecord[] = [];
    const nowIso = new Date().toISOString();
    for (const s of sessions) {
      const isExpired = s.expiresAt < nowIso;
      if (s.status === 'failed' || s.status === 'expired' || isExpired || (s.status === 'pending' && s.createdAt < cutoff)) {
        const sessionDir = join(tmpDir(), s.id);
        if (existsSync(sessionDir)) {
          rmSync(sessionDir, { recursive: true, force: true });
        }
        cleanedCount++;
        if (s.status === 'completed') remaining.push(s);
      } else {
        remaining.push(s);
      }
    }
    writeLocalSessions(remaining);
    return cleanedCount;
  }

  const db = createServiceClient();
  const { data: expiredSessions, error: queryError } = await db
    .from('design_upload_sessions')
    .select('id, files_expected, status')
    .is('cleaned_at', null)
    .lt('expires_at', cutoff)
    .limit(50);

  if (queryError) throw new Error(`업로드 정리 조회 실패: ${queryError.message}`);

  if (Array.isArray(expiredSessions) && expiredSessions.length > 0) {
    const filesToRemove: string[] = [];
    const cleanedIds: string[] = [];
    for (const s of expiredSessions) {
      if (s.status === 'pending') {
        const { data: marked, error } = await db.from('design_upload_sessions').update({ status: 'expired' }).eq('id', s.id).eq('status', 'pending').select('id');
        if (error) throw new Error(`업로드 정리 상태 변경 실패: ${error.message}`);
        if (!marked?.length) continue;
      }
      const expected = (s.files_expected ?? {}) as UploadSessionRecord['filesExpected'];
      if (expected.sticker?.path) filesToRemove.push(expected.sticker.path);
      if (expected.card?.path) filesToRemove.push(expected.card.path);
      cleanedIds.push(s.id);
      cleanedCount++;
    }
    if (filesToRemove.length > 0) {
      const { error } = await db.storage.from(PRINT_BUCKET).remove(filesToRemove);
      if (error) throw new Error(`업로드 임시 파일 정리 실패: ${error.message}`);
    }
    if (cleanedIds.length) {
      const { error } = await db.from('design_upload_sessions').update({ cleaned_at: new Date().toISOString() }).in('id', cleanedIds);
      if (error) throw new Error(`업로드 정리 기록 실패: ${error.message}`);
    }
  }

  return cleanedCount;
}
