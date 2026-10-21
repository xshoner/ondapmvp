import type { ImageLayer, TextLayer } from '@/packaging/types.ts';

// 편집 중에만 쓰는 값: 고객이 올린 사진은 blob 주소와 원본 픽셀 폭을 들고 있다가 저장할 때 'upload'로 바꾼다
export type EditorImageLayer = ImageLayer & { uploaded?: boolean; naturalWidth?: number };
export type EditorLayer = EditorImageLayer | TextLayer;

export interface CanvasApi {
  // 재단 여백 포함 한 변 pixels 크기의 PNG (안내선·선택 상자 제외)
  exportPng(pixels: number): Promise<Blob>;
}
