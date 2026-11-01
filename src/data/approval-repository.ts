import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { ApprovalDraft, ApprovalDraftEditable } from '../approval/types.ts';

const DRAFTS_DIR = path.resolve(process.cwd(), 'data', 'approval-drafts');
const IMAGES_DIR = path.resolve(DRAFTS_DIR, 'images');

// 문서 ID별 동시 저장 직렬화 잠금 큐
const draftLocks = new Map<string, Promise<unknown>>();

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
  await fs.mkdir(IMAGES_DIR, { recursive: true });
}

function getDraftPath(id: string): string {
  if (!isValidUUID(id)) {
    throw new Error('유효하지 않은 초안 식별자입니다.');
  }
  return path.join(DRAFTS_DIR, `${id}.json`);
}

export async function getDraft(id: string): Promise<ApprovalDraft | null> {
  if (!isValidUUID(id)) return null;
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
  return withDraftLock(id, async () => {
    try {
      const filePath = getDraftPath(id);
      await fs.unlink(filePath);

      // 해당 초안의 캐시 이미지들도 정리 시도
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

// 안전한 상품 이미지 다운로드 및 로컬 캐싱
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

    await ensureDirs();
    const filename = `${draftId}_${productNo}.png`;
    const destPath = path.join(IMAGES_DIR, filename);

    // 이미 캐시되어 있으면 재사용
    try {
      await fs.access(destPath);
      return filename;
    } catch {}

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

    await fs.writeFile(destPath, processed);
    return filename;
  } catch {
    // 이미지 다운로드 실패 시 null 반환 (문서 생성은 대체 박스로 성공)
    return null;
  }
}

export function getCachedImagePath(filename: string): string {
  // 경로 순회 방지
  const safeFilename = path.basename(filename);
  return path.join(IMAGES_DIR, safeFilename);
}
