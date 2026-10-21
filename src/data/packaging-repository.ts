// 포장 디자인 데이터 입구. repository.ts와 같이 ONDAP_DATA_SOURCE로 로컬 JSON / Supabase를 고른다.
//
// 로컬 모드: 자산 data/packaging.json, 접수 data/designs.json, 인쇄 파일 data/design-files/, 관리자 업로드 public/packaging/uploads/
// Supabase : 표 packaging_styles·design_images·design_texts·designs, 저장소 packaging-assets(공개)·design-files(비공개)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, projectRoot } from '../lib/paths.ts';
import { dataSource } from '../lib/supabase/env.ts';
import { createClient } from '../lib/supabase/server.ts';
import type { EventType } from '../engine/types.ts';
import type { Design, DesignDraft, DesignImage, DesignStatus, DesignText, PackagingAssets, PackagingStyle, StickerSpec } from '../packaging/types.ts';

export type AssetKind = 'styles' | 'images' | 'texts';
type AssetRow = PackagingStyle | DesignImage | DesignText;

const TABLE: Record<AssetKind, string> = { styles: 'packaging_styles', images: 'design_images', texts: 'design_texts' };
const ASSET_BUCKET = 'packaging-assets';
const PRINT_BUCKET = 'design-files';

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what} 실패: ${error?.message ?? '알 수 없는 오류'}`);
}

const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort;

// ---------- 로컬 JSON ----------

const assetsFile = join(dataDir, 'packaging.json');
const designsFile = join(dataDir, 'designs.json');
const printDir = join(dataDir, 'design-files');

function readLocalAssets(): PackagingAssets & { _note?: string } {
  return JSON.parse(readFileSync(assetsFile, 'utf8'));
}

function writeLocalAssets(value: PackagingAssets & { _note?: string }): void {
  writeFileSync(assetsFile, JSON.stringify(value, null, 2) + '\n');
}

function readLocalDesigns(): Design[] {
  return existsSync(designsFile) ? JSON.parse(readFileSync(designsFile, 'utf8')) : [];
}

function writeLocalDesigns(designs: Design[]): void {
  writeFileSync(designsFile, JSON.stringify(designs, null, 2) + '\n');
}

// ---------- Supabase 행 변환 ----------

type Row = Record<string, any>;
const styleFromRow = (r: Row): PackagingStyle => ({ id: r.id, name: r.name, description: r.description, imageUrl: r.image_url, active: r.active, sort: r.sort });
const imageFromRow = (r: Row): DesignImage => ({ id: r.id, category: r.category, name: r.name, imageUrl: r.image_url, active: r.active, sort: r.sort });
const textFromRow = (r: Row): DesignText => ({ id: r.id, category: r.category, text: r.text, active: r.active, sort: r.sort });
const designFromRow = (r: Row): Design => ({
  code: r.code,
  createdAt: r.created_at,
  productNo: r.product_no,
  productName: r.product_name,
  quantity: r.quantity,
  event: r.event,
  styleId: r.style_id ?? '',
  styleName: r.style_name,
  sticker: r.sticker,
  draft: r.draft ?? null,
  hasPrintFile: Boolean(r.print_path),
  status: r.status,
  orderNo: r.order_no,
  memo: r.memo,
});

function assetToRow(kind: AssetKind, a: AssetRow): Record<string, unknown> {
  const base = { active: a.active, sort: a.sort };
  if (kind === 'styles') { const s = a as PackagingStyle; return { ...base, name: s.name, description: s.description, image_url: s.imageUrl }; }
  if (kind === 'images') { const i = a as DesignImage; return { ...base, category: i.category, name: i.name, image_url: i.imageUrl }; }
  const t = a as DesignText;
  return { ...base, category: t.category, text: t.text };
}

// ---------- 자산 (스타일·추천 이미지·추천 문구) ----------

// 고객 화면은 사용 중인 것만, 관리자 화면은 전부
export async function getPackagingAssets(opts: { includeInactive?: boolean } = {}): Promise<PackagingAssets> {
  let assets: PackagingAssets;
  if (dataSource() === 'local') {
    const { styles, images, texts } = readLocalAssets();
    assets = { styles, images, texts };
  } else {
    const db = await createClient();
    const [s, i, t] = await Promise.all([
      db.from('packaging_styles').select('*'),
      db.from('design_images').select('*'),
      db.from('design_texts').select('*'),
    ]);
    if (s.error) fail('포장 스타일 읽기', s.error);
    if (i.error) fail('추천 이미지 읽기', i.error);
    if (t.error) fail('추천 문구 읽기', t.error);
    assets = { styles: s.data.map(styleFromRow), images: i.data.map(imageFromRow), texts: t.data.map(textFromRow) };
  }
  const keep = <T extends { active: boolean }>(xs: T[]) => (opts.includeInactive ? xs : xs.filter((x) => x.active));
  return {
    styles: keep(assets.styles).sort(bySort),
    images: keep(assets.images).sort(bySort),
    texts: keep(assets.texts).sort(bySort),
  };
}

// id가 비어 있으면 새로 만든다
export async function saveAsset(kind: AssetKind, asset: AssetRow): Promise<void> {
  if (dataSource() === 'local') {
    const file = readLocalAssets();
    const list = file[kind] as AssetRow[];
    const i = list.findIndex((x) => x.id === asset.id);
    if (i === -1) list.push({ ...asset, id: asset.id || `${kind[0]}${Date.now().toString(36)}` });
    else list[i] = asset;
    return writeLocalAssets(file);
  }
  const db = await createClient();
  const row = assetToRow(kind, asset);
  const { error, count } = asset.id
    ? await db.from(TABLE[kind]).update(row, { count: 'exact' }).eq('id', asset.id)
    : await db.from(TABLE[kind]).insert(row, { count: 'exact' });
  if (error) fail('저장', error);
  if (count === 0) fail('저장', { message: '권한이 없거나 항목이 없습니다.' });
}

export async function deleteAsset(kind: AssetKind, id: string): Promise<void> {
  if (dataSource() === 'local') {
    const file = readLocalAssets();
    file[kind] = (file[kind] as AssetRow[]).filter((x) => x.id !== id) as never;
    return writeLocalAssets(file);
  }
  const db = await createClient();
  const { error } = await db.from(TABLE[kind]).delete().eq('id', id);
  if (error) fail('삭제', error);
}

// 관리자가 올린 스타일·추천 이미지 파일. 공개 주소를 돌려준다
export async function uploadAssetFile(folder: 'styles' | 'images', bytes: Uint8Array, ext: 'webp' | 'png' | 'jpg', contentType: string): Promise<string> {
  const name = `${folder}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  if (dataSource() === 'local') {
    const path = join(projectRoot, 'public', 'packaging', 'uploads', name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, bytes);
    return `/packaging/uploads/${name}`;
  }
  const db = await createClient();
  const { error } = await db.storage.from(ASSET_BUCKET).upload(name, bytes, { contentType, upsert: false });
  if (error) fail('파일 올리기', error);
  return db.storage.from(ASSET_BUCKET).getPublicUrl(name).data.publicUrl;
}

// ---------- 디자인 접수 ----------

export interface NewDesign {
  code: string;
  productNo: number;
  productName: string;
  quantity: number;
  event: EventType | null;
  styleId: string;
  styleName: string;
  sticker: StickerSpec | null;
  draft: DesignDraft | null;
}

// 인쇄 파일을 먼저 올리고 접수 행을 만든다. 코드가 겹치면 'duplicate'
export async function createDesign(design: NewDesign, printPng: Uint8Array | null): Promise<'ok' | 'duplicate'> {
  const printPath = printPng ? `${design.code}.png` : null;
  if (dataSource() === 'local') {
    const all = readLocalDesigns();
    if (all.some((d) => d.code === design.code)) return 'duplicate';
    if (printPng && printPath) {
      mkdirSync(printDir, { recursive: true });
      writeFileSync(join(printDir, printPath), printPng);
    }
    all.unshift({ ...design, createdAt: new Date().toISOString(), hasPrintFile: Boolean(printPng), status: 'received', orderNo: null, memo: '' });
    writeLocalDesigns(all);
    return 'ok';
  }
  const db = await createClient();
  if (printPng && printPath) {
    const up = await db.storage.from(PRINT_BUCKET).upload(printPath, printPng, { contentType: 'image/png', upsert: false });
    if (up.error) {
      if (/exists|duplicate/i.test(up.error.message)) return 'duplicate';
      fail('인쇄 파일 저장', up.error);
    }
  }
  const { error } = await db.from('designs').insert({
    code: design.code,
    product_no: design.productNo,
    product_name: design.productName,
    quantity: design.quantity,
    event: design.event,
    style_id: design.styleId || null,
    style_name: design.styleName,
    sticker: design.sticker,
    draft: design.draft,
    print_path: printPath,
  });
  if (error?.code === '23505') return 'duplicate';
  if (error) fail('디자인 접수', error);
  return 'ok';
}

// 목록에는 편집 내용(draft, 건당 최대 64KB)이 필요 없으므로 빼고 읽는다 (draft는 null)
const LIST_COLUMNS = 'code, created_at, product_no, product_name, quantity, event, style_id, style_name, sticker, print_path, status, order_no, memo';

export async function listDesigns(opts: { limit?: number; code?: string | null } = {}): Promise<Design[]> {
  const limit = opts.limit ?? 200;
  if (dataSource() === 'local') {
    return readLocalDesigns().filter((d) => !opts.code || d.code === opts.code).slice(0, limit).map((d) => ({ ...d, draft: null }));
  }
  const db = await createClient();
  let q = db.from('designs').select(LIST_COLUMNS).order('created_at', { ascending: false }).limit(limit);
  if (opts.code) q = q.eq('code', opts.code);
  const { data, error } = await q;
  if (error) fail('디자인 목록 읽기', error);
  return data.map(designFromRow);
}

export async function updateDesign(code: string, patch: { status: DesignStatus; orderNo: string | null; memo: string }): Promise<void> {
  if (dataSource() === 'local') {
    const all = readLocalDesigns();
    const d = all.find((x) => x.code === code);
    if (!d) throw new Error('디자인을 찾을 수 없습니다.');
    Object.assign(d, patch);
    return writeLocalDesigns(all);
  }
  const db = await createClient();
  const { error, count } = await db
    .from('designs')
    .update({ status: patch.status, order_no: patch.orderNo, memo: patch.memo, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('code', code);
  if (error) fail('디자인 수정', error);
  if (count === 0) fail('디자인 수정', { message: '권한이 없거나 디자인이 없습니다.' });
}

// 관리자 내려받기용 인쇄 파일 (호출하는 쪽에서 관리자 확인)
export async function readPrintFile(code: string): Promise<Uint8Array | null> {
  if (dataSource() === 'local') {
    const path = join(printDir, `${code}.png`);
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  }
  const db = await createClient();
  const { data, error } = await db.storage.from(PRINT_BUCKET).download(`${code}.png`);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

