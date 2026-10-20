import type { EngineConfig, EventType, Relation } from './types.ts';

// 'funeral' 또는 '장례'처럼 id나 한글 이름 어느 쪽으로도 찾는다
export function parseEvent(config: EngineConfig, value: string): EventType {
  const hit = (Object.keys(config.events) as EventType[]).find((k) => k === value || config.events[k].name === value);
  if (!hit) throw new Error(`행사 유형을 찾을 수 없습니다: ${value} (가능: ${Object.values(config.events).map((e) => e.name).join(', ')})`);
  return hit;
}

export function parseRelation(config: EngineConfig, value: string): Relation {
  const hit = (Object.keys(config.relations) as Relation[]).find((k) => k === value || config.relations[k].name === value);
  if (!hit) throw new Error(`관계를 찾을 수 없습니다: ${value} (가능: ${Object.values(config.relations).map((r) => r.name).join(', ')})`);
  return hit;
}
