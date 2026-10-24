import type { Box } from '@/packaging/rules.ts';
import type { DesignCategory, DesignDraft, ImageLayer, StickerShape, StickerSizeCm, TextLayer } from '@/packaging/types.ts';

// 편집 중에만 쓰는 값: 고객이 올린 사진은 blob 주소와 원본 픽셀 폭을 들고 있다가 저장할 때 'upload'로 바꾼다.
// photoId: 이 기기(IndexedDB)에 넣어 둔 사진 원본의 열쇠 (자동 보관·다시 꾸미기에서 다시 꺼낸다)
export type EditorImageLayer = ImageLayer & { uploaded?: boolean; naturalWidth?: number; photoId?: string };
export type EditorLayer = EditorImageLayer | TextLayer;

export interface CanvasApi {
  // 재단 여백 포함 한 변 pixels 크기의 PNG (안내선·선택 상자 제외)
  exportPng(pixels: number): Promise<Blob>;
}

// 캔버스가 잰 문구 상자 (편집기 좌표). 어떤 글자·크기로 잰 값인지 함께 보낸다
export type TextRect = Box & { text: string; fontSize: number };

// 편집 상태 한 벌: 자동 보관과 '내 디자인 다시 꾸미기'가 함께 쓴다
export interface EditorSnapshot {
  purpose?: 'return' | 'celebration';
  styleId: string;
  withSticker: boolean;
  shape: StickerShape;
  sizeCm: StickerSizeCm;
  background: string;
  layers: EditorLayer[];
  fields: DesignDraft['fields'];
  event: DesignCategory | null;
  quantity: number;
}
