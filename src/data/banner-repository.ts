// 메인 배너 데이터 저장소 (로컬 JSON / Supabase 양방향 지원)
// 활성 배너 단일 불변식(Exactly One Active Banner)을 DB RPC 및 로컬 트랜잭션으로 엄격히 보장한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataDir, projectRoot } from '../lib/paths.ts';
import { dataSource } from '../lib/supabase/env.ts';
import { fail } from './db.ts';

export type BannerSeasonType = 'default' | 'chuseok' | 'christmas' | 'custom';

export interface MainBanner {
  id: string;
  title: string;
  imageUrl: string;
  linkUrl: string;
  altText: string;
  isActive: boolean;
  seasonType: BannerSeasonType;
  badgeText: string;
  headline: string;
  subText: string;
  buttonText: string;
  createdAt: string;
  updatedAt: string;
}

export interface MainBannerInput {
  title: string;
  imageUrl?: string;
  linkUrl?: string;
  altText?: string;
  isActive?: boolean;
  seasonType?: BannerSeasonType;
  badgeText?: string;
  headline?: string;
  subText?: string;
  buttonText?: string;
}

const currentDataDir = () => process.env.ONDAP_TEST_DATA_DIR || dataDir;
const bannersFile = () => join(currentDataDir(), 'banners.json');
const createClient = async () => (await import('../lib/supabase/server.ts')).createClient();

// ---------- 기본값 복원 헬퍼 ----------
const DEFAULT_BANNERS: MainBanner[] = [
  {
    id: 'banner-default',
    title: '기본형 배너 (AI 격식지수 추천)',
    imageUrl: '',
    linkUrl: 'https://dapcue.vercel.app/',
    altText: '답례큐 AI 추천 큐레이션 메인 배너',
    isActive: true,
    seasonType: 'default',
    badgeText: '답례큐 AI 추천 큐레이션',
    headline: '자리에 맞는 답례, 답례큐가 추천드려요.',
    subText: '행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.',
    buttonText: '답례품 추천받기',
    createdAt: '2026-11-17T00:00:00.000Z',
    updatedAt: '2026-11-17T00:00:00.000Z',
  },
  {
    id: 'banner-chuseok',
    title: '추석 명절 시즌 배너',
    imageUrl: '/banners/chuseok.webp',
    linkUrl: 'https://dapcue.vercel.app/',
    altText: '답례큐 한가위 추석 선물 큐레이션 메인 배너',
    isActive: false,
    seasonType: 'chuseok',
    badgeText: '답례큐 추석 특별 큐레이션',
    headline: '마음을 전하는 한가위 답례, 답례큐가 추천드려요.',
    subText: '행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.',
    buttonText: '추석 답례품 추천받기',
    createdAt: '2026-11-17T00:00:00.000Z',
    updatedAt: '2026-11-17T00:00:00.000Z',
  },
  {
    id: 'banner-christmas',
    title: '크리스마스 연말 시즌 배너',
    imageUrl: '/banners/christmas.webp',
    linkUrl: 'https://dapcue.vercel.app/',
    altText: '답례큐 크리스마스 연말 선물 큐레이션 메인 배너',
    isActive: false,
    seasonType: 'christmas',
    badgeText: '답례큐 연말·성탄 특별 큐레이션',
    headline: '따뜻한 마음을 담은 연말 답례, 답례큐가 추천드려요.',
    subText: '행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.',
    buttonText: '연말 답례품 추천받기',
    createdAt: '2026-11-17T00:00:00.000Z',
    updatedAt: '2026-11-17T00:00:00.000Z',
  },
];

// ---------- 로컬 파일 핸들러 ----------
function readLocalBanners(): MainBanner[] {
  const f = bannersFile();
  if (!existsSync(f)) {
    writeLocalBanners(DEFAULT_BANNERS);
    return DEFAULT_BANNERS;
  }
  try {
    const list = JSON.parse(readFileSync(f, 'utf8'));
    return Array.isArray(list) ? list : DEFAULT_BANNERS;
  } catch {
    return DEFAULT_BANNERS;
  }
}

function writeLocalBanners(banners: MainBanner[]): void {
  const f = bannersFile();
  const dir = currentDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(f, JSON.stringify(banners, null, 2) + '\n');
}

// ---------- DB 행 매핑 ----------
function bannerFromRow(r: Record<string, any>): MainBanner {
  return {
    id: r.id,
    title: r.title,
    imageUrl: r.image_url ?? '',
    linkUrl: r.link_url ?? 'https://dapcue.vercel.app/',
    altText: r.alt_text ?? '',
    isActive: Boolean(r.is_active),
    seasonType: (r.season_type as BannerSeasonType) || 'default',
    badgeText: r.badge_text || '답례큐 AI 추천 큐레이션',
    headline: r.headline || '자리에 맞는 답례, 답례큐가 추천드려요.',
    subText: r.sub_text || '행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.',
    buttonText: r.button_text || '답례품 추천받기',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------- Repository 함수 ----------

export async function listBanners(): Promise<MainBanner[]> {
  if (dataSource() === 'local') {
    return readLocalBanners();
  }
  const db = await createClient();
  const { data, error } = await db.from('main_banners').select('*').order('created_at', { ascending: true });
  if (error) fail('배너 목록 읽기', error);
  return (data || []).map(bannerFromRow);
}

export async function getActiveBanner(): Promise<MainBanner | null> {
  if (dataSource() === 'local') {
    const list = readLocalBanners();
    return list.find((b) => b.isActive) || list.find((b) => b.id === 'banner-default') || list[0] || null;
  }
  const db = await createClient();
  const { data, error } = await db.from('main_banners').select('*').eq('is_active', true).maybeSingle();
  if (error) fail('활성 배너 읽기', error);
  if (!data) return null;
  return bannerFromRow(data);
}

// 단일 원자적 활성화: 없는 ID는 기존 상태 보존하고 실패, 단 하나의 배너만 활성화 보장
export async function setActiveBanner(id: string): Promise<MainBanner> {
  if (!id || typeof id !== 'string') {
    throw new Error('유효한 배너 ID를 지정해 주세요.');
  }

  if (dataSource() === 'local') {
    const list = readLocalBanners();
    const target = list.find((b) => b.id === id);
    if (!target) {
      // 없는 ID: 기존 상태를 전혀 수정하지 않고 즉시 예외 발생
      throw new Error(`존재하지 않는 배너 ID입니다: ${id}`);
    }
    const now = new Date().toISOString();
    const updated = list.map((b) => ({
      ...b,
      isActive: b.id === id,
      updatedAt: b.id === id ? now : b.updatedAt,
    }));
    writeLocalBanners(updated);
    return updated.find((b) => b.id === id)!;
  }

  // Supabase 모드: 관리자 검증과 원자적 처리가 포함된 단일 DB 트랜잭션 RPC 실행
  const db = await createClient();
  const { data, error } = await db.rpc('set_active_main_banner', { p_banner_id: id });
  if (error || !data) {
    fail('배너 활성화 트랜잭션 실패', error);
  }
  return bannerFromRow(data);
}

export async function createBanner(input: MainBannerInput): Promise<MainBanner> {
  if (!input.title?.trim()) throw new Error('배너 제목을 입력해 주세요.');

  const id = `banner-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  const wantActive = Boolean(input.isActive);

  const banner: MainBanner = {
    id,
    title: input.title.trim().slice(0, 60),
    imageUrl: (input.imageUrl || '').trim().slice(0, 500),
    linkUrl: (input.linkUrl || 'https://dapcue.vercel.app/').trim().slice(0, 500),
    altText: (input.altText || input.title).trim().slice(0, 200),
    isActive: wantActive,
    seasonType: input.seasonType || 'custom',
    badgeText: (input.badgeText || '답례큐 AI 추천 큐레이션').trim().slice(0, 50),
    headline: (input.headline || '자리에 맞는 답례, 답례큐가 추천드려요.').trim().slice(0, 100),
    subText: (input.subText || '행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.').trim().slice(0, 200),
    buttonText: (input.buttonText || '답례품 추천받기').trim().slice(0, 50),
    createdAt: now,
    updatedAt: now,
  };

  if (dataSource() === 'local') {
    const list = readLocalBanners();
    const hasAnyActive = list.some((b) => b.isActive);
    // 불변식: 활성 요청이면 이전 배너들 비활성화, 만약 기존에 활성 배너가 1개도 없었다면 강제 활성화
    const finalActive = wantActive || !hasAnyActive;
    banner.isActive = finalActive;

    const updated = finalActive ? list.map((b) => ({ ...b, isActive: false })) : [...list];
    updated.push(banner);
    writeLocalBanners(updated);
    return banner;
  }

  const db = await createClient();
  // 먼저 비활성 상태로 레코드 안전 삽입
  const { data, error } = await db.from('main_banners').insert({
    id: banner.id,
    title: banner.title,
    image_url: banner.imageUrl,
    link_url: banner.linkUrl,
    alt_text: banner.altText,
    is_active: false,
    season_type: banner.seasonType,
    badge_text: banner.badgeText,
    headline: banner.headline,
    sub_text: banner.subText,
    button_text: banner.buttonText,
    created_at: now,
    updated_at: now,
  }).select().single();

  if (error || !data) fail('배너 생성 실패', error);

  // 활성화 요청이거나 기존 활성 배너가 없다면 단일 트랜잭션 RPC로 활성화
  if (wantActive) {
    return setActiveBanner(banner.id);
  }
  const existingActive = await getActiveBanner();
  if (!existingActive) {
    return setActiveBanner(banner.id);
  }

  return bannerFromRow(data);
}

export async function updateBanner(id: string, patch: Partial<MainBannerInput>): Promise<MainBanner> {
  const now = new Date().toISOString();

  if (dataSource() === 'local') {
    const list = readLocalBanners();
    const target = list.find((b) => b.id === id);
    if (!target) throw new Error('수정할 배너를 찾을 수 없습니다.');

    // 활성 상태 불변식 유지: 활성 배너를 false로 끄려 하면 기본 배너로 자동 안전 전환
    let nextIsActive = target.isActive;
    let fallbackDefaultActive = false;
    if (patch.isActive !== undefined) {
      if (patch.isActive) {
        nextIsActive = true;
      } else if (target.isActive) {
        // 활성 배너를 끄면 banner-default 활성화
        nextIsActive = false;
        fallbackDefaultActive = true;
      }
    }

    const updated = list.map((b) => {
      if (b.id === id) {
        return {
          ...b,
          title: patch.title !== undefined ? patch.title.trim().slice(0, 60) : b.title,
          imageUrl: patch.imageUrl !== undefined ? patch.imageUrl.trim().slice(0, 500) : b.imageUrl,
          linkUrl: patch.linkUrl !== undefined ? patch.linkUrl.trim().slice(0, 500) : b.linkUrl,
          altText: patch.altText !== undefined ? patch.altText.trim().slice(0, 200) : b.altText,
          isActive: nextIsActive,
          seasonType: patch.seasonType || b.seasonType,
          badgeText: patch.badgeText !== undefined ? patch.badgeText.trim().slice(0, 50) : b.badgeText,
          headline: patch.headline !== undefined ? patch.headline.trim().slice(0, 100) : b.headline,
          subText: patch.subText !== undefined ? patch.subText.trim().slice(0, 200) : b.subText,
          buttonText: patch.buttonText !== undefined ? patch.buttonText.trim().slice(0, 50) : b.buttonText,
          updatedAt: now,
        };
      }
      if (nextIsActive) return { ...b, isActive: false };
      if (fallbackDefaultActive && b.id === 'banner-default') return { ...b, isActive: true, updatedAt: now };
      return b;
    });

    writeLocalBanners(updated);
    return updated.find((b) => b.id === id)!;
  }

  const db = await createClient();
  const dbPatch: Record<string, any> = { updated_at: now };
  if (patch.title !== undefined) dbPatch.title = patch.title.trim().slice(0, 60);
  if (patch.imageUrl !== undefined) dbPatch.image_url = patch.imageUrl.trim().slice(0, 500);
  if (patch.linkUrl !== undefined) dbPatch.link_url = patch.linkUrl.trim().slice(0, 500);
  if (patch.altText !== undefined) dbPatch.alt_text = patch.altText.trim().slice(0, 200);
  if (patch.seasonType !== undefined) dbPatch.season_type = patch.seasonType;
  if (patch.badgeText !== undefined) dbPatch.badge_text = patch.badgeText.trim().slice(0, 50);
  if (patch.headline !== undefined) dbPatch.headline = patch.headline.trim().slice(0, 100);
  if (patch.subText !== undefined) dbPatch.sub_text = patch.subText.trim().slice(0, 200);
  if (patch.buttonText !== undefined) dbPatch.button_text = patch.buttonText.trim().slice(0, 50);

  const { data, error } = await db.from('main_banners').update(dbPatch).eq('id', id).select().single();
  if (error || !data) fail('배너 수정 실패', error);

  if (patch.isActive === true) {
    return setActiveBanner(id);
  } else if (patch.isActive === false && data.is_active) {
    await setActiveBanner('banner-default');
    const { data: refreshed } = await db.from('main_banners').select('*').eq('id', id).single();
    return bannerFromRow(refreshed);
  }

  return bannerFromRow(data);
}

export async function deleteBanner(id: string): Promise<void> {
  if (id === 'banner-default') {
    throw new Error('기본형 배너는 삭제할 수 없습니다.');
  }

  if (dataSource() === 'local') {
    const list = readLocalBanners();
    const target = list.find((b) => b.id === id);
    if (!target) return;

    // 만약 삭제 대상이 활성 배너라면, 같은 쓰기 작업에서 banner-default를 활성화하여 불변식 보존
    let nextList = list.filter((b) => b.id !== id);
    if (target.isActive) {
      nextList = nextList.map((b) => (b.id === 'banner-default' ? { ...b, isActive: true, updatedAt: new Date().toISOString() } : b));
    }
    writeLocalBanners(nextList);
    return;
  }

  const db = await createClient();
  const { data: target } = await db.from('main_banners').select('is_active').eq('id', id).maybeSingle();
  if (!target) return;

  // 활성 배너 삭제 전 먼저 banner-default를 단일 RPC로 활성화하여 활성 배너 0개 상태를 방지
  if (target.is_active) {
    await setActiveBanner('banner-default');
  }

  const { error } = await db.from('main_banners').delete().eq('id', id);
  if (error) fail('배너 삭제 실패', error);
}

// 관리자가 등록한 배너 이미지 업로드 (전용 공개 버킷 banner-assets만 사용, 타 버킷 폴백 없음)
export async function uploadBannerFile(bytes: Uint8Array, ext: 'webp' | 'png' | 'jpg', mime: string): Promise<string> {
  const filename = `${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
  if (dataSource() === 'local') {
    const dir = join(projectRoot, 'public', 'banners', 'uploads');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), bytes);
    return `/banners/uploads/${filename}`;
  }

  const db = await createClient();
  const bucket = 'banner-assets';
  const path = `uploads/${filename}`;

  const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false });
  if (error) {
    fail('공개 배너 전용 버킷(banner-assets) 업로드 실패', error);
  }

  const { data } = db.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
