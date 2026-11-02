import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { dataDir } from '../lib/paths.ts';
import { dataSource } from '../lib/supabase/env.ts';
import type { ApprovalDraft, ApprovalDraftEditable } from '../approval/types.ts';

const DRAFTS_DIR = path.resolve(dataDir, 'approval-drafts');
const IMAGES_DIR = path.resolve(DRAFTS_DIR, 'images');

// 문서 ID별 동시 저장 직렬화 잠금 큐 (로컬 파일 시스템 전용)
const draftLocks = new Map<string, Promise<unknown>>();

let testServiceClient: any = null;
export function setApprovalServiceClientForTest(client: any) {
  testServiceClient = client;
}

async function getServiceClient() {
  if (testServiceClient) return testServiceClient;
  const { createServiceClient } = await import('../lib/supabase/service.ts');
  return createServiceClient();
}

export async function withDraftLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  const currentLock = draftLocks.get(id) ?? Promise.resolve();
  let release: () => void;
  const nextLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  draftLocks.set(id, nextLock);

  try {
    await currentLock;
    return await action();
  } finally {
    release!();
    if (draftLocks.get(id) === nextLock) {
      draftLocks.delete(id);
    }
  }
}

export class RevisionConflictError extends Error {
  currentRevision: number;
  constructor(message: string, currentRevision: number) {
    super(message);
    this.name = 'RevisionConflictError';
    this.currentRevision = currentRevision;
  }
}

// UUID v4 형식 검증
export function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

async function ensureDirs() {
  try {
    await fs.mkdir(IMAGES_DIR, { recursive: true });
  } catch {}
}

function getDraftPath(id: string): string {
  if (!isValidUUID(id)) {
    throw new Error('유효하지 않은 초안 식별자입니다.');
  }
  return path.join(DRAFTS_DIR, `${id}.json`);
}

export async function getDraft(id: string): Promise<ApprovalDraft | null> {
  if (!isValidUUID(id)) return null;

  if (dataSource() === 'supabase') {
    try {
      const client = await getServiceClient();
      const { data: row, error } = await client
        .from('approval_drafts')
        .select('data, creator_token_hash, revision, created_at, updated_at')
        .eq('id', id)
        .maybeSingle();

      if (error || !row) return null;

      const draft = row.data as ApprovalDraft;
      draft.revision = row.revision;
      draft.creatorTokenHash = row.creator_token_hash;
      draft.createdAt = row.created_at;
      draft.updatedAt = row.updated_at;
      return draft;
    } catch {
      return null;
    }
  }

  try {
    const filePath = getDraftPath(id);
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as ApprovalDraft;
    return parsed;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export async function saveDraft(draft: ApprovalDraft, expectedRevision?: number): Promise<ApprovalDraft> {
  if (!isValidUUID(draft.id)) {
    throw new Error('유효하지 않은 초안 식별자입니다.');
  }

  if (dataSource() === 'supabase') {
    const client = await getServiceClient();

    const { data: existing, error: checkError } = await client
      .from('approval_drafts')
      .select('revision, creator_token_hash')
      .eq('id', draft.id)
      .maybeSingle();

    if (checkError) {
      throw new Error(`초안 조회 실패: ${checkError.message}`);
    }

    if (existing) {
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw new RevisionConflictError(
          `초안 개정번호 충돌: 요청된 개정번호(${expectedRevision})와 현재 개정번호(${existing.revision})가 일치하지 않습니다.`,
          existing.revision,
        );
      }
      const nextRevision = existing.revision + 1;
      const now = new Date().toISOString();
      draft.revision = nextRevision;
      draft.updatedAt = now;
      if (!draft.creatorTokenHash && existing.creator_token_hash) {
        draft.creatorTokenHash = existing.creator_token_hash;
      }

      // 조건부 원자적 갱신: 개정번호가 일치할 때만 1행 갱신
      const { data: updated, error } = await client
        .from('approval_drafts')
        .update({
          revision: nextRevision,
          data: draft,
          updated_at: now,
        })
        .eq('id', draft.id)
        .eq('revision', expectedRevision ?? existing.revision)
        .select('revision, updated_at')
        .maybeSingle();

      if (error) throw new Error(`초안 저장 오류: ${error.message}`);
      if (!updated) {
        const { data: current } = await client
          .from('approval_drafts')
          .select('revision')
          .eq('id', draft.id)
          .maybeSingle();
        throw new RevisionConflictError(
          `초안 개정번호 충돌: 요청된 개정번호(${expectedRevision ?? existing.revision})와 현재 개정번호(${current?.revision ?? 0})가 일치하지 않습니다.`,
          current?.revision ?? 0,
        );
      }

      return draft;
    } else {
      // 신규 초안 생성
      draft.revision = 1;
      const now = new Date().toISOString();
      draft.createdAt = draft.createdAt || now;
      draft.updatedAt = now;

      const { error } = await client.from('approval_drafts').insert({
        id: draft.id,
        revision: draft.revision,
        creator_token_hash: draft.creatorTokenHash || '',
        data: draft,
        created_at: draft.createdAt,
        updated_at: draft.updatedAt,
      });

      if (error) throw new Error(`초안 생성 오류: ${error.message}`);
      return draft;
    }
  }

  // 로컬 파일 저장소 모드
  return withDraftLock(draft.id, async () => {
    await ensureDirs();
    const filePath = getDraftPath(draft.id);

    let existing: ApprovalDraft | null = null;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      existing = JSON.parse(content) as ApprovalDraft;
    } catch (err: unknown) {
      if (!err || typeof err !== 'object' || !('code' in err) || err.code !== 'ENOENT') {
        throw err;
      }
    }

    if (existing) {
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw new RevisionConflictError(
          `초안 개정번호 충돌: 요청된 개정번호(${expectedRevision})와 현재 개정번호(${existing.revision})가 일치하지 않습니다.`,
          existing.revision,
        );
      }
      draft.revision = existing.revision + 1;
      draft.updatedAt = new Date().toISOString();
      if (!draft.creatorTokenHash && existing.creatorTokenHash) {
        draft.creatorTokenHash = existing.creatorTokenHash;
      }
    } else {
      draft.revision = 1;
      const now = new Date().toISOString();
      draft.createdAt = draft.createdAt || now;
      draft.updatedAt = now;
    }

    // 원자적 파일 쓰기 (임시 파일 후 이름 변경)
    const tempPath = path.join(DRAFTS_DIR, `${draft.id}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    await fs.writeFile(tempPath, JSON.stringify(draft, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);

    return draft;
  });
}

export async function updateDraftEditable(
  id: string,
  patch: Partial<ApprovalDraftEditable>,
  expectedRevision: number,
): Promise<ApprovalDraft> {
  if (!isValidUUID(id)) {
    throw new Error('유효하지 않은 초안 식별자입니다.');
  }

  if (dataSource() === 'supabase') {
    const client = await getServiceClient();

    const existing = await getDraft(id);
    if (!existing) {
      throw new Error('해당 결재 문서 초안을 찾을 수 없습니다.');
    }

    if (existing.revision !== expectedRevision) {
      throw new RevisionConflictError(
        `초안 개정번호 충돌: 요청된 개정번호(${expectedRevision})와 현재 개정번호(${existing.revision})가 일치하지 않습니다.`,
        existing.revision,
      );
    }

    const nextRevision = existing.revision + 1;
    const now = new Date().toISOString();
    const updatedDraft: ApprovalDraft = {
      ...existing,
      revision: nextRevision,
      updatedAt: now,
      editable: {
        ...existing.editable,
        ...patch,
      },
    };

    // DB 조건부 갱신
    const { data: updated, error } = await client
      .from('approval_drafts')
      .update({
        revision: nextRevision,
        data: updatedDraft,
        updated_at: now,
      })
      .eq('id', id)
      .eq('revision', expectedRevision)
      .select('revision, updated_at')
      .maybeSingle();

    if (error) throw new Error(`초안 수정 오류: ${error.message}`);
    if (!updated) {
      const { data: current } = await client
        .from('approval_drafts')
        .select('revision')
        .eq('id', id)
        .maybeSingle();
      throw new RevisionConflictError(
        `초안 개정번호 충돌: 요청된 개정번호(${expectedRevision})와 현재 개정번호(${current?.revision ?? 0})가 일치하지 않습니다.`,
        current?.revision ?? 0,
      );
    }

    return updatedDraft;
  }

  // 로컬 파일 저장소 모드
  return withDraftLock(id, async () => {
    const filePath = getDraftPath(id);
    let existing: ApprovalDraft | null = null;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      existing = JSON.parse(content) as ApprovalDraft;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        throw new Error('해당 결재 문서 초안을 찾을 수 없습니다.');
      }
      throw err;
    }

    if (!existing) {
      throw new Error('해당 결재 문서 초안을 찾을 수 없습니다.');
    }

    if (existing.revision !== expectedRevision) {
      throw new RevisionConflictError(
        `초안 개정번호 충돌: 요청된 개정번호(${expectedRevision})와 현재 개정번호(${existing.revision})가 일치하지 않습니다.`,
        existing.revision,
      );
    }

    const updatedDraft: ApprovalDraft = {
      ...existing,
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
      editable: {
        ...existing.editable,
        ...patch,
      },
    };

    const tempPath = path.join(DRAFTS_DIR, `${id}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    await fs.writeFile(tempPath, JSON.stringify(updatedDraft, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);

    return updatedDraft;
  });
}

export async function deleteDraft(id: string): Promise<boolean> {
  if (!isValidUUID(id)) return false;

  if (dataSource() === 'supabase') {
    try {
      const client = await getServiceClient();
      const { data, error } = await client
        .from('approval_drafts')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error || !data) return false;

      // 비공개 저장소 이미지 정리 시도
      try {
        const { data: files } = await client.storage.from('approval-assets').list(id);
        if (files && files.length > 0) {
          await client.storage.from('approval-assets').remove(files.map((f: { name: string }) => `${id}/${f.name}`));
        }
      } catch {}

      return true;
    } catch {
      return false;
    }
  }

  // 로컬 파일 저장소 모드
  return withDraftLock(id, async () => {
    try {
      const filePath = getDraftPath(id);
      await fs.unlink(filePath);

      // 해당 초안의 캐시 이미지 정리 시도
      try {
        const files = await fs.readdir(IMAGES_DIR);
        for (const file of files) {
          if (file.startsWith(`${id}_`)) {
            await fs.unlink(path.join(IMAGES_DIR, file)).catch(() => {});
          }
        }
      } catch {}

      return true;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  });
}

// 안전한 상품 이미지 다운로드 및 영구 캐싱
export async function cacheProductImage(imageUrl: string, draftId: string, productNo: number): Promise<string | null> {
  if (!imageUrl || !imageUrl.startsWith('https://')) {
    return null;
  }

  try {
    const parsedUrl = new URL(imageUrl);
    const hostname = parsedUrl.hostname.toLowerCase();

    // 사설 IP 및 로컬 주소 차단
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return null;
    }

    const filename = `${draftId}_${productNo}.png`;

    // 다운로드 (timeout 5초, 최대 5MB)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'OndapMVP-Approval/1.0',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
      return null; // 5MB 초과
    }

    const buffer = Buffer.from(arrayBuffer);

    // sharp로 400x400 내로 리사이즈 및 PNG 변환
    const processed = await sharp(buffer)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();

    // 로컬 폴더에 저장 시도
    try {
      await ensureDirs();
      const destPath = path.join(IMAGES_DIR, filename);
      await fs.writeFile(destPath, processed);
    } catch {}

    // Supabase 모드인 경우 비공개 저장소 버킷에도 지속 저장
    if (dataSource() === 'supabase') {
      try {
        const client = await getServiceClient();
        await client.storage.from('approval-assets').upload(`${draftId}/${productNo}.png`, processed, {
          contentType: 'image/png',
          upsert: true,
        });
      } catch {}
    }

    return filename;
  } catch {
    return null;
  }
}

export function getCachedImagePath(filename: string): string {
  const safeFilename = path.basename(filename);
  return path.join(IMAGES_DIR, safeFilename);
}

// DOCX/HWPX/PDF 생성 시 이미지 바이트 읽기 (로컬 파일 또는 비공개 Supabase 버킷)
export async function readProductImageBytes(filename: string): Promise<Buffer | null> {
  const safeFilename = path.basename(filename);
  const localPath = path.join(IMAGES_DIR, safeFilename);

  try {
    const bytes = await fs.readFile(localPath);
    return bytes;
  } catch {}

  if (dataSource() === 'supabase') {
    try {
      const m = safeFilename.match(/^([0-9a-f-]+)_(\d+)\.png$/i);
      if (m) {
        const client = await getServiceClient();
        const { data, error } = await client.storage.from('approval-assets').download(`${m[1]}/${m[2]}.png`);
        if (data && !error) {
          const ab = await data.arrayBuffer();
          return Buffer.from(ab);
        }
      }
    } catch {}
  }

  return null;
}
