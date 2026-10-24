// 브라우저 전용 도우미: 카페24 주문 주소 만들기, 이 기기에 저장한 디자인 목록
import { isMobileUA, isObj } from '@/lib/device.ts';
import { productOrderUrl } from '@/lib/order-link.ts';

// 카페24 상품 주소에 코드·수량을 붙인다. 쇼핑몰 스킨의 public/cafe24/ondap-helper.js가 읽어 수량을 맞추고 주문서에 코드를 넣는다.
// 휴대폰은 처음부터 모바일 쇼핑몰(/m/) 주소로 보낸다: PC 주소로 가면 카페24가 /m/으로 넘기면서 붙인 값을 버린다
export function orderUrl(productUrl: string, code: string, quantity: number): string {
  return productOrderUrl(productUrl, quantity, code, isMobileUA());
}

// 이 기기에 저장한 디자인 (최근 10개). 다른 기기에서는 코드로 조회한다
export interface SavedDesign {
  code: string;
  productName: string;
  productUrl: string;
  quantity: number;
  savedAt: string;
  thumb: string | null; // 160px webp data URL (약 10KB)
  // 다시 꾸미기용 (예전에 저장한 항목에는 없다). snapshot 모양은 app/packaging/editor-store.ts가 읽고 검사한다
  productNo?: number;
  snapshot?: unknown;
}

const KEY = 'ondap_my_designs';
const MAX = 10;

const isSaved = (x: unknown): x is SavedDesign => {
  if (!isObj(x)) return false;
  const { code, productName, productUrl, quantity, savedAt, thumb } = x;
  return typeof code === 'string' && typeof productName === 'string' && typeof productUrl === 'string' && Number.isFinite(quantity)
    && typeof savedAt === 'string' && !Number.isNaN(Date.parse(savedAt)) && (thumb === null || typeof thumb === 'string');
};

export function loadSavedDesigns(): SavedDesign[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(isSaved) : [];
  } catch {
    return [];
  }
}

export function rememberDesign(d: SavedDesign): void {
  try {
    const rest = loadSavedDesigns().filter((x) => x.code !== d.code);
    localStorage.setItem(KEY, JSON.stringify([d, ...rest].slice(0, MAX)));
  } catch {
    // 저장 공간이 꽉 찼거나 막힌 브라우저: 코드 조회로 대신한다
  }
}

export function forgetDesign(code: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadSavedDesigns().filter((x) => x.code !== code)));
  } catch {
    // 무시
  }
}

// 인쇄 파일(최대 756px)을 목록용 작은 그림으로
export async function makeThumb(blob: Blob, size = 160): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, size, size);
    return canvas.toDataURL('image/webp', 0.8);
  } catch {
    return null;
  }
}
