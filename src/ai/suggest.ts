// AI 점수 제안: 프롬프트, 응답 스키마, 응답 검증 (순수 함수 — 모델 호출은 gemini.ts)
//
// 원칙: AI는 "제안"만 한다. 관리자가 확인·수정한 뒤 저장해야 반영되며, 추천 순위 계산에는 관여하지 않는다.

import type { EngineConfig, EventType, ProductAttributes, Relation } from '../engine/types.ts';

export interface SuggestInput {
  productName: string;
  price: number;
  region: string;
  category: string;
  story: string;
  tags: string[];
}

export interface AiSuggestion {
  scores: Record<string, number>;
  reasons: Record<string, string>;
  events: EventType[];
  relations: Relation[];
  excludedEvents: { event: EventType; reason: string }[];
  meanings: Partial<Record<EventType, string>>;
  tags: string[];
  region: string | null;
  summary: string;
  model: string;
}

export function buildPrompt(config: EngineConfig, input: SuggestInput): { system: string; user: string } {
  const indicators = config.indicators
    .map((i) => `- ${i.id} (${i.name}, 0~${i.max}점): ${i.description}${i.mode === 'target' ? ' — 높을수록 격식 있는 자리용(고급·공식), 낮을수록 가벼운 자리용' : ''}`)
    .join('\n');
  const events = Object.entries(config.events).map(([id, e]) => `${id}=${e.name}`).join(', ');
  const relations = Object.entries(config.relations).map(([id, r]) => `${id}=${r.name}`).join(', ');

  const system = `당신은 한국 지역특산물 답례품 큐레이션 서비스 '온답'의 상품 평가 담당자입니다.
관리자가 상품을 등록할 때 격식지수 지표 점수와 적합한 상황을 '제안'합니다. 관리자가 검토 후 확정합니다.

[지표]
${indicators}

[행사 유형] ${events}
[받는 분 관계] ${relations}

[규칙]
1. 주어진 상품명·가격·산지·카테고리·스토리만 근거로 판단합니다. 적혀 있지 않은 인증, 수상, 명인 이력은 지어내지 않습니다.
2. 근거가 부족한 지표는 5점을 주고 근거에 "정보 부족"이라고 씁니다.
3. 점수는 정수입니다. 근거는 한국어로 60자 이내, 상품 정보의 어떤 부분 때문인지 씁니다.
4. events는 이 상품이 특히 잘 어울리는 행사, relations는 잘 어울리는 관계만 고릅니다.
5. excludedEvents는 그 행사에 보내면 결례이거나 곤란한 경우만 넣습니다. 예: 신선·냉장 상품은 대량 발송하는 장례 답례에 부적합, 복숭아는 제례·상례에 쓰지 않는 관습. 제외한 행사는 events에 넣지 않습니다.
6. meanings는 한국에서 널리 알려진 선물의 의미가 있을 때만 씁니다(예: 개업 선물 소금, 출산 미역, 결혼 참기름 '깨가 쏟아지는'). 없으면 비웁니다.
7. tags는 상품명·스토리에 실제로 있는 특징만 2~4개, '#' 없이 씁니다.
8. region은 상품명·스토리에 드러난 시·군 이름(예: 영광, 하동). 알 수 없으면 "국내".`;

  const user = `다음 상품을 평가해 주세요.
상품명: ${input.productName}
가격: ${input.price.toLocaleString('ko-KR')}원
산지(현재 입력값): ${input.region || '미입력'}
카테고리: ${input.category || '미입력'}
상품 스토리: ${input.story || '미입력'}
현재 태그: ${input.tags.length ? input.tags.join(', ') : '없음'}`;

  return { system, user };
}

// Gemini responseJsonSchema용 JSON 스키마 (지표·행사·관계 목록은 설정에서 만든다)
export function suggestionSchema(config: EngineConfig): Record<string, unknown> {
  const eventIds = Object.keys(config.events);
  const relationIds = Object.keys(config.relations);
  const scoreProps = Object.fromEntries(
    config.indicators.map((i) => [
      i.id,
      {
        type: 'object',
        properties: {
          score: { type: 'integer', minimum: 0, maximum: i.max },
          reason: { type: 'string' },
        },
        required: ['score', 'reason'],
      },
    ]),
  );
  return {
    type: 'object',
    properties: {
      scores: { type: 'object', properties: scoreProps, required: config.indicators.map((i) => i.id) },
      events: { type: 'array', items: { type: 'string', enum: eventIds } },
      relations: { type: 'array', items: { type: 'string', enum: relationIds } },
      excludedEvents: {
        type: 'array',
        items: {
          type: 'object',
          properties: { event: { type: 'string', enum: eventIds }, reason: { type: 'string' } },
          required: ['event', 'reason'],
        },
      },
      meanings: {
        type: 'array',
        items: {
          type: 'object',
          properties: { event: { type: 'string', enum: eventIds }, meaning: { type: 'string' } },
          required: ['event', 'meaning'],
        },
      },
      tags: { type: 'array', items: { type: 'string' } },
      region: { type: 'string' },
      summary: { type: 'string', description: '이 상품을 한 문장으로 평가' },
    },
    required: ['scores', 'events', 'relations', 'excludedEvents', 'meanings', 'tags', 'region', 'summary'],
  };
}

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

// 모델 응답을 믿지 않고 다시 검사한다: 모르는 지표·행사·관계는 버리고, 점수는 범위 안 정수로 맞춘다
export function normalizeSuggestion(raw: unknown, config: EngineConfig, model: string): AiSuggestion {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const eventIds = new Set(Object.keys(config.events));
  const relationIds = new Set(Object.keys(config.relations));

  const scores: Record<string, number> = {};
  const reasons: Record<string, string> = {};
  const rawScores = (obj.scores && typeof obj.scores === 'object' ? obj.scores : {}) as Record<string, unknown>;
  for (const ind of config.indicators) {
    const entry = rawScores[ind.id] as { score?: unknown; reason?: unknown } | undefined;
    const n = Number(entry?.score);
    if (!Number.isFinite(n)) continue;
    scores[ind.id] = Math.min(ind.max, Math.max(0, Math.round(n)));
    reasons[ind.id] = clip(entry?.reason, 120);
  }
  if (Object.keys(scores).length === 0) throw new Error('AI 응답에 지표 점수가 없습니다.');

  const excludedEvents: { event: EventType; reason: string }[] = [];
  for (const x of Array.isArray(obj.excludedEvents) ? obj.excludedEvents : []) {
    const e = x as { event?: unknown; reason?: unknown };
    if (typeof e.event === 'string' && eventIds.has(e.event) && clip(e.reason, 1)) {
      if (!excludedEvents.some((y) => y.event === e.event)) excludedEvents.push({ event: e.event as EventType, reason: clip(e.reason, 120) });
    }
  }
  const excluded = new Set(excludedEvents.map((x) => x.event));

  const uniq = <T extends string>(arr: unknown, allowed: Set<string>): T[] =>
    [...new Set((Array.isArray(arr) ? arr : []).filter((v): v is string => typeof v === 'string' && allowed.has(v)))] as T[];

  const meanings: Partial<Record<EventType, string>> = {};
  for (const x of Array.isArray(obj.meanings) ? obj.meanings : []) {
    const m = x as { event?: unknown; meaning?: unknown };
    if (typeof m.event === 'string' && eventIds.has(m.event) && !excluded.has(m.event as EventType) && clip(m.meaning, 1)) {
      meanings[m.event as EventType] = clip(m.meaning, 80);
    }
  }

  const tags = [...new Set((Array.isArray(obj.tags) ? obj.tags : []).map((t) => clip(t, 20).replace(/^#/, '')).filter(Boolean))].slice(0, 4);

  return {
    scores,
    reasons,
    events: uniq<EventType>(obj.events, eventIds).filter((e) => !excluded.has(e)),
    relations: uniq<Relation>(obj.relations, relationIds),
    excludedEvents,
    meanings,
    tags,
    region: clip(obj.region, 20) || null,
    summary: clip(obj.summary, 200),
    model,
  };
}

// 제안을 현재 입력값 위에 적용한 결과 (UI의 "모두 적용")
export function applySuggestion(current: ProductAttributes, s: AiSuggestion): ProductAttributes {
  return {
    ...current,
    scores: { ...current.scores, ...s.scores },
    events: s.events,
    relations: s.relations,
    excludedEvents: s.excludedEvents,
    meanings: { ...s.meanings },
    tags: s.tags.length ? s.tags : current.tags,
    region: current.region && current.region !== '국내' ? current.region : (s.region ?? current.region),
  };
}
