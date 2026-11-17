'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-guard.ts';
import {
  createBanner,
  deleteBanner,
  listBanners,
  setActiveBanner,
  updateBanner,
  uploadBannerFile,
  type BannerSeasonType,
  type MainBanner,
  type MainBannerInput,
} from '@/data/banner-repository.ts';

type Result<T = void> = { ok: true; data?: T } | { ok: false; message: string };

const MAX_BANNER_BYTES = 3 * 1024 * 1024;

async function denied(): Promise<{ ok: false; message: string } | null> {
  try {
    await requireAdmin();
    return null;
  } catch (e) {
    return { ok: false, message: `${e instanceof Error ? e.message : String(e)} 다시 로그인해 주세요.` };
  }
}

// 파일 헤더(매직 바이트)로 실제 이미지 포맷 검증
function sniff(bytes: Uint8Array): { ext: 'webp' | 'png' | 'jpg'; type: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return { ext: 'png', type: 'image/png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  return null;
}

function isSafeUrl(url: string): boolean {
  if (!url) return true;
  if (url.startsWith('/')) return true;
  try {
    const p = new URL(url);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function listBannersAction(): Promise<Result<MainBanner[]>> {
  const no = await denied();
  if (no) return no;
  try {
    const list = await listBanners();
    return { ok: true, data: list };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function setActiveBannerAction(id: string): Promise<Result<MainBanner>> {
  const no = await denied();
  if (no) return no;
  try {
    const banner = await setActiveBanner(id);
    revalidatePath('/admin/packaging');
    return { ok: true, data: banner };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function uploadBannerImageAction(form: FormData): Promise<Result<string>> {
  const no = await denied();
  if (no) return no;
  try {
    const file = form.get('file');
    if (!(file instanceof Blob)) return { ok: false, message: '업로드할 파일이 없습니다.' };
    if (file.size > MAX_BANNER_BYTES) return { ok: false, message: '파일 용량은 3MB 이하만 가능합니다.' };
    if (file.size < 100) return { ok: false, message: '비정상적인 파일입니다.' };

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind) {
      return { ok: false, message: 'JPG, PNG, WEBP 형식의 유효한 이미지만 등록할 수 있습니다.' };
    }

    const url = await uploadBannerFile(bytes, kind.ext, kind.type);
    return { ok: true, data: url };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function createBannerAction(input: MainBannerInput): Promise<Result<MainBanner>> {
  const no = await denied();
  if (no) return no;
  try {
    if (!input.title?.trim()) return { ok: false, message: '배너 제목을 입력해 주세요.' };
    if (input.linkUrl && !isSafeUrl(input.linkUrl)) {
      return { ok: false, message: '유효한 링크 URL (http:// 또는 https://)을 입력해 주세요.' };
    }
    const created = await createBanner(input);
    revalidatePath('/admin/packaging');
    return { ok: true, data: created };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateBannerAction(id: string, patch: Partial<MainBannerInput>): Promise<Result<MainBanner>> {
  const no = await denied();
  if (no) return no;
  try {
    if (patch.title !== undefined && !patch.title.trim()) {
      return { ok: false, message: '배너 제목을 입력해 주세요.' };
    }
    if (patch.linkUrl && !isSafeUrl(patch.linkUrl)) {
      return { ok: false, message: '유효한 링크 URL (http:// 또는 https://)을 입력해 주세요.' };
    }
    const updated = await updateBanner(id, patch);
    revalidatePath('/admin/packaging');
    return { ok: true, data: updated };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteBannerAction(id: string): Promise<Result<void>> {
  const no = await denied();
  if (no) return no;
  try {
    await deleteBanner(id);
    revalidatePath('/admin/packaging');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
