// DB 행(snake_case) ↔ 엔진 타입(camelCase) 변환. 순수 함수라 테스트한다.

import type { Cafe24Product, EventType, ProductAttributes, Relation } from '../engine/types.ts';

export interface ProductRow {
  product_no: number;
  name: string;
  price: number;
  display: boolean;
  selling: boolean;
  sold_out: boolean;
  image: string | null;
  detail_image: string | null;
  url: string;
  synced_at?: string;
}

export interface AttributesRow {
  product_no: number;
  region: string;
  category: string;
  scores: Record<string, number>;
  events: string[];
  relations: string[];
  excluded_events: { event: string; reason: string }[];
  meanings: Record<string, string>;
  tags: string[];
  story: string;
  reviewed: boolean;
  updated_at?: string;
  updated_by?: string | null;
}

export function productFromRow(r: ProductRow): Cafe24Product {
  return {
    productNo: r.product_no,
    name: r.name,
    price: r.price,
    display: r.display,
    selling: r.selling,
    soldOut: r.sold_out,
    image: r.image,
    detailImage: r.detail_image,
    url: r.url,
  };
}

export function productToRow(p: Cafe24Product): ProductRow {
  return {
    product_no: p.productNo,
    name: p.name,
    price: Math.round(p.price),
    display: p.display,
    selling: p.selling,
    sold_out: p.soldOut,
    image: p.image,
    detail_image: p.detailImage,
    url: p.url,
  };
}

export function attributesFromRow(r: AttributesRow): ProductAttributes {
  return {
    productNo: r.product_no,
    region: r.region,
    category: r.category,
    scores: r.scores ?? {},
    events: (r.events ?? []) as EventType[],
    relations: (r.relations ?? []) as Relation[],
    excludedEvents: (r.excluded_events ?? []) as ProductAttributes['excludedEvents'],
    meanings: (r.meanings ?? {}) as ProductAttributes['meanings'],
    tags: r.tags ?? [],
    story: r.story ?? '',
    reviewed: r.reviewed,
  };
}

export function attributesToRow(a: ProductAttributes): AttributesRow {
  return {
    product_no: a.productNo,
    region: a.region,
    category: a.category,
    scores: a.scores,
    events: a.events,
    relations: a.relations,
    excluded_events: a.excludedEvents,
    meanings: a.meanings as Record<string, string>,
    tags: a.tags,
    story: a.story,
    reviewed: a.reviewed,
  };
}
