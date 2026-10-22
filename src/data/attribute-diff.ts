// 상품 지표 두 벌의 차이를 사람이 읽는 줄로: 변경 이력 화면과 엑셀 올리기 미리보기가 함께 쓴다 (순수 함수)

import { eventIds, relationIds } from '../engine/labels.ts';
import type { EngineConfig, ProductAttributes } from '../engine/types.ts';

export interface FieldChange { label: string; from: string; to: string }

const list = (xs: string[]) => (xs.length ? xs.join(', ') : '없음');

export function attributeDiff(before: ProductAttributes | null, after: ProductAttributes, config: EngineConfig): FieldChange[] {
  const out: FieldChange[] = [];
  const add = (label: string, from: string, to: string) => { if (from !== to) out.push({ label, from, to }); };
  const evName = (id: string) => config.events[id as keyof EngineConfig['events']]?.name ?? id;
  const relName = (id: string) => config.relations[id as keyof EngineConfig['relations']]?.name ?? id;
  // 행사·관계는 화면 순서대로 비교한다 (저장 순서가 달라도 같은 내용이면 차이 없음)
  const evs = (xs: string[]) => eventIds(config).filter((id) => xs.includes(id)).map(evName);
  const rels = (xs: string[]) => relationIds(config).filter((id) => xs.includes(id)).map(relName);
  const excl = (a: ProductAttributes | null) =>
    eventIds(config).flatMap((id) => {
      const x = a?.excludedEvents.find((e) => e.event === id);
      return x ? [`${evName(id)}(${x.reason})`] : [];
    });
  const b = before;

  add('산지', b?.region ?? '', after.region);
  add('분류', b?.category ?? '', after.category);
  for (const ind of config.indicators) add(ind.name, b ? String(b.scores[ind.id] ?? 0) : '', String(after.scores[ind.id] ?? 0));
  add('어울리는 행사', b ? list(evs(b.events)) : '', list(evs(after.events)));
  add('어울리는 관계', b ? list(rels(b.relations)) : '', list(rels(after.relations)));
  add('제외 행사', b ? list(excl(b)) : '', list(excl(after)));
  for (const id of eventIds(config)) add(`${evName(id)} 선물의 의미`, b?.meanings[id] ?? '', after.meanings[id] ?? '');
  add('해시태그', b ? list(b.tags) : '', list(after.tags));
  add('스토리', b?.story ?? '', after.story);
  add('검토 완료', b ? (b.reviewed ? '예' : '아니오') : '', after.reviewed ? '예' : '아니오');
  return out;
}
