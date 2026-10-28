import { loadCatalog } from '../src/data/catalog.ts';
import { evaluateFormality } from '../src/engine/eligibility.ts';
import { formalitySamples, SAMPLE_INPUT } from '../src/engine/formality-samples.ts';

const { catalog, workspace } = formalitySamples(loadCatalog());
const result = evaluateFormality(catalog, workspace, SAMPLE_INPUT);
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
else {
  console.log('검증용 가상 상품 3개 — 실제 판매·인증 자료가 아닙니다.');
  console.log(`행사 격식 ${result.event.score}점 / 희소 허용 ${result.event.band.min}~${result.event.band.max} / 기준 ${result.policyVersion}`);
  console.table(result.decisions.map((d) => ({ 상품: d.product.name, 희소값: d.rarity.value, 판정: d.eligible ? '적격' : '제외', 순위점수: d.rankScore, 이유: d.reason })));
  console.log(result.notice);
}
