// 포장 디자인(실물 포장 스타일 선택 + 무료 스티커 편집) 데이터 형태

import type { EventType } from '../engine/types.ts';

// 추천 이미지·문구 분류: 엔진의 행사 8종 + 공통
export type DesignCategory = EventType | 'common';

export interface PackagingStyle {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  active: boolean;
  sort: number;
}

export interface DesignImage {
  id: string;
  category: DesignCategory;
  name: string;
  imageUrl: string;
  active: boolean;
  sort: number;
}

export interface DesignText {
  id: string;
  category: DesignCategory;
  // {받는분} {보내는분} {날짜} 자리표시자를 쓸 수 있다
  text: string;
  active: boolean;
  sort: number;
}

export interface PackagingAssets {
  styles: PackagingStyle[];
  images: DesignImage[];
  texts: DesignText[];
}

export type StickerShape = 'circle' | 'square';
export type StickerSizeCm = 4 | 6;

export interface StickerSpec {
  shape: StickerShape;
  sizeCm: StickerSizeCm;
}

// 편집기 레이어. 좌표는 재단 여백을 포함한 전체 캔버스를 1000으로 본 값이라 크기를 바꿔도 배치가 유지된다
interface LayerBase {
  id: string;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  // 추천 이미지는 주소, 고객이 올린 사진은 'upload' (원본은 인쇄 파일에만 담긴다)
  src: string;
  width: number;
  height: number;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  font: string;
  fontSize: number;
  color: string;
  stroke: string | null;
  shadow: boolean;
}

export type Layer = ImageLayer | TextLayer;

export interface DesignDraft {
  background: string;
  layers: Layer[];
  fields: { recipient: string; sender: string; date: string };
}

export type DesignStatus = 'received' | 'order_confirmed' | 'printed' | 'canceled';

export interface Design {
  code: string;
  createdAt: string;
  productNo: number;
  productName: string;
  quantity: number;
  event: EventType | null;
  styleId: string;
  styleName: string;
  sticker: StickerSpec | null;
  draft: DesignDraft | null;
  hasPrintFile: boolean;
  // 인쇄 파일이 들어 있는 접수 코드: 보통 자기 코드, '같은 디자인으로 다시 주문'한 접수는 원본 코드
  printCode: string | null;
  sourceCode: string | null; // 다시 주문한 접수의 원본
  status: DesignStatus;
  statusChangedAt: string;
  orderNo: string | null;
  memo: string;
}
