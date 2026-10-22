// 결과 설명: 격식 단계 이름과 ONDAP'S PICK 추천 문구
// 점수 내역만으로 만드는 규칙 기반 문구다. 나중에 AI 문구로 바꿔도 순위에는 영향이 없다.

import { isDepopulationArea } from './formality.ts';
import type { EngineConfig, IndicatorContribution, ProductAttributes, RecommendInput } from './types.ts';

export function tierFor(config: EngineConfig, formalityScore: number): string {
  const tier = config.tiers.find((t) => formalityScore >= t.minFormality);
  return tier?.label ?? config.tiers[config.tiers.length - 1]?.label ?? '';
}

// 받침 유무로 을/를 고르기 (한글이 아니면 '을(를)')
export function objectParticle(word: string): string {
  const last = word.trim().at(-1);
  if (!last) return '를';
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return '을(를)';
  return code % 28 === 0 ? '를' : '을';
}

export function buildReason(
  config: EngineConfig,
  input: RecommendInput,
  productName: string,
  attrs: ProductAttributes,
  indicators: IndicatorContribution[],
): string {
  const situation = `${config.events[input.event].name} ${config.relations[input.relation].name} 답례`;
  const sentences = [`${situation}로는 ${productName}${objectParticle(productName)} 추천드립니다.`];

  const meaning = attrs.meanings?.[input.event];
  if (meaning) sentences.push(`‘${meaning}’${objectParticle(meaning)} 담았습니다.`);

  // 가장 많은 점수를 만든 지표 두 개를 이유로 든다
  const top = [...indicators].sort((a, b) => b.points - a.points).slice(0, 2);
  const phrases = top
    .map((c) => config.indicators.find((i) => i.id === c.id)?.reasonPhrase)
    .filter((p): p is string => Boolean(p));
  if (phrases.length) sentences.push(`${phrases.join('이자 ')}입니다.`);

  if (isDepopulationArea(config, attrs.region)) {
    sentences.push(`${attrs.region}의 생산자를 응원하는 상생 선물이기도 합니다.`);
  }
  return sentences.join(' ');
}
