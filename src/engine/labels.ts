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

// 설정을 DB(jsonb)에서 읽으면 키 순서가 바뀐다 → 화면에는 정해 둔 순서로 (설정에 새로 생긴 키는 뒤에)
const EVENT_ORDER = ['funeral', 'wedding', 'longevity', 'birth', 'promotion', 'opening', 'thanks', 'birthday'];
const RELATION_ORDER = ['senior', 'business', 'peer', 'family'];

function ordered(keys: string[], order: string[]): string[] {
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return [...keys].sort((a, b) => rank(a) - rank(b));
}

export function eventIds(config: EngineConfig): EventType[] {
  return ordered(Object.keys(config.events), EVENT_ORDER) as EventType[];
}

export function relationIds(config: EngineConfig): Relation[] {
  return ordered(Object.keys(config.relations), RELATION_ORDER) as Relation[];
}
