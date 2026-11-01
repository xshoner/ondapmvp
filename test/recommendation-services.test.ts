import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalCoreStore } from '../src/recommendation/local-store.ts';
import { createRecommendationServices, groundSuggestion } from '../src/recommendation/services.ts';
import { policyFromConfig, type CoreStore } from '../src/recommendation/store.ts';
import { createDraftPolicy } from '../src/recommendation/policy.ts';
import { parseProductAssessment } from '../src/recommendation/validation.ts';
import { sampleInputs, sampleAssessment, sampleRequest } from './fixtures/recommendation-inputs.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'ondap-core-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { products } = sampleInputs();
  const catalog = products.map((p) => ({ ...p, image: p.imageUrl, url: p.productUrl, originalField: 'preserve' }));
  await mkdir(join(root, 'config'));
  await writeFile(join(root, 'cafe24-products.json'), JSON.stringify({ products: catalog }));
  await writeFile(join(root, 'config', 'engine.json'), JSON.stringify({ unrelated: { keep: 42 } }));
  return { root, catalog, store: createLocalCoreStore(root) };
}
const fresh = (no = 900001) => ({ ...sampleAssessment(no), updatedAt: null, reviewedAt: null });

test('local core: first save preserves catalog shape; numeric assessment roundtrips without client timestamps', async (t) => {
  const { store, root, catalog } = await fixture(t);
  const input = fresh();
  const saved = await store.saveAssessment(input, null);
  assert.notEqual(saved.updatedAt, null);
  assert.equal(input.updatedAt, null);
  assert.deepEqual((await store.load()).assessments, [saved]);
  const raw = JSON.parse(await readFile(join(root, 'formality-pilot.json'), 'utf8'));
  assert.deepEqual(raw.products, catalog);
  assert.equal(raw.items['900001'].rarity, null);
  assert.equal(raw.items['900001'].factors.skill.method, 'numeric');
});

test('local core: two independent stores saving the same revision have one winner and one conflict', async (t) => {
  const { store, root } = await fixture(t);
  const first = await store.saveAssessment(fresh(), null);
  const another = createLocalCoreStore(root);
  const edits = ['first operator', 'second operator'].map((description) => ({ ...first, description }));
  const result = await Promise.allSettled([store.saveAssessment(edits[0], first.updatedAt), another.saveAssessment(edits[1], first.updatedAt)]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = result.find((r) => r.status === 'rejected');
  assert.equal(rejected?.reason.code, 'revision_conflict');
  const winner = result.find((r) => r.status === 'fulfilled');
  assert.deepEqual((await store.load()).assessments[0], winner?.value);
});

test('local core: parallel writes to different products preserve both and cannot overwrite a saved policy', async (t) => {
  const { store, root } = await fixture(t);
  const other = createLocalCoreStore(root);
  await Promise.all([store.saveAssessment(fresh(900001), null), other.saveAssessment(fresh(900002), null)]);
  assert.equal((await store.load()).assessments.length, 2);
  const policy = createDraftPolicy();
  const outcomes = await Promise.allSettled([store.savePolicy(policy, null), other.savePolicy({ ...policy, version: 'other' }, null)]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((r) => r.status === 'rejected')?.reason.code, 'revision_conflict');
  const config = JSON.parse(await readFile(join(root, 'config', 'engine.json'), 'utf8'));
  assert.deepEqual(config.unrelated, { keep: 42 });
});

test('local core: legacy evidence and unrelated metadata survive a save; invalid review does not write', async (t) => {
  const { store, root } = await fixture(t);
  const legacy = { productNo: 900001, reviewed: true, factors: { skill: { level: 'high', basis: '원문 그대로\n보존' }, history: { level: 'medium', basis: '기록' } }, updatedAt: '2026-01-01T00:00:00.000Z', reviewedBy: 'old-operator', notes: ['keep'] };
  await writeFile(join(root, 'formality-pilot.json'), JSON.stringify({ items: { 900001: legacy }, extra: 'keep' }));
  const loaded = (await store.load()).assessments[0];
  await store.saveAssessment(loaded, loaded.updatedAt);
  const before = await readFile(join(root, 'formality-pilot.json'), 'utf8');
  const raw = JSON.parse(before);
  assert.deepEqual(raw.items['900001'].factors.skill, legacy.factors.skill);
  assert.deepEqual(raw.items['900001'].notes, ['keep']);
  assert.equal(raw.extra, 'keep');
  const blank = parseProductAssessment({ productNo: 900002, reviewed: true, factors: {} });
  await assert.rejects(store.saveAssessment(blank, null), { code: 'invalid_input' });
  assert.equal(await readFile(join(root, 'formality-pilot.json'), 'utf8'), before);
  await store.saveAssessment({ ...blank, reviewed: false }, null);
  assert.equal((await store.load()).assessments.length, 2);
});

test('core policy migration preserves v2 targets and weights without importing v1 recommendation weights', () => {
  const p = createDraftPolicy();
  const config = { weights: { trust: 1000 }, formalityV2: { ...p, eventBase: { ...p.eventBase, wedding: 77 }, bands: p.rarityBands.map((b) => ({ from: b.from, min: b.min / 100, max: b.max / 100 })) } };
  const result = policyFromConfig(config);
  assert.equal(result.eventBase.wedding, 77);
  assert.deepEqual(result.rarityBands, p.rarityBands);
  assert.deepEqual(result.scoreWeights, { eventFit: 70, priceValue: 30 });
  assert.throws(() => policyFromConfig({ formalityV2: { eventBase: {} } }));
});

test('local core: oversized UTF-8 evidence fails without truncating or replacing saved data', async (t) => {
  const { store, root } = await fixture(t);
  const saved = await store.saveAssessment(fresh(), null);
  const before = await readFile(join(root, 'formality-pilot.json'), 'utf8');
  const edited = structuredClone(saved);
  for (const factor of Object.values(edited.factors)) factor.basis = '한'.repeat(2000);
  await assert.rejects(store.saveAssessment(edited, saved.updatedAt), { code: 'invalid_input' });
  assert.equal(await readFile(join(root, 'formality-pilot.json'), 'utf8'), before);
  assert.equal(edited.factors.skill.basis.length, 2000);
});

test('core services: all administrator methods authenticate before reading or writing', async () => {
  let stores = 0;
  const services = createRecommendationServices({ requireAdmin: async () => { throw Error('private reason'); }, loadStore: async () => { stores++; throw Error('must not load'); }, suggest: async () => { throw Error('must not invoke'); } });
  const commands = [services.loadWorkspace(), services.loadPolicy(), services.loadAssessment(1), services.saveAssessment({ assessment: fresh(), expectedUpdatedAt: null }), services.savePolicy({ policy: createDraftPolicy(), expectedUpdatedAt: null }), services.suggestAssessment({ productNo: 1, description: 'source' }), services.previewRecommendation({ request: sampleRequest, policy: createDraftPolicy() })];
  for (const result of await Promise.all(commands)) { assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'unauthorized'); }
  assert.equal(stores, 0);
});

test('core services: public scores match saved policy; preview and AI never persist data', async (t) => {
  const { store } = await fixture(t);
  for (const a of sampleInputs().assessments) await store.saveAssessment(a, null);
  const services = createRecommendationServices({ requireAdmin: async () => {}, loadStore: async () => store, suggest: async (no, source) => groundSuggestion(no, source, { factors: [{ key: 'history', score: 7, basis: source }] }) });
  const before = structuredClone(await store.load());
  const result = await services.recommend(sampleRequest);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.items.map((i) => i.recommendationScore), [86.8, 82.2, 78.5]);
    assert.equal(JSON.stringify(result.data).includes('[가상] skill 확인 근거'), false);
  }
  const preview = await services.previewRecommendation({ request: sampleRequest, policy: { ...createDraftPolicy(), scoreWeights: { eventFit: 100, priceValue: 0 } } });
  assert.equal(preview.ok, true);
  if (preview.ok) assert.equal(preview.data.items[0].recommendationScore, 100);
  const suggestion = await services.suggestAssessment({ productNo: 900001, description: '원자료에 기재된 제작 기록' });
  assert.equal(suggestion.ok, true);
  assert.deepEqual(await store.load(), before);
});

test('core services: AI failure, invalid input and storage failures return bounded errors', async (t) => {
  const { store } = await fixture(t);
  const services = createRecommendationServices({ requireAdmin: async () => {}, loadStore: async () => store, suggest: async () => { throw Error('secret upstream diagnostic'); } });
  const before = await store.load();
  const ai = await services.suggestAssessment({ productNo: 900001, description: '원자료' });
  assert.equal(ai.ok, false);
  if (!ai.ok) { assert.equal(ai.error.code, 'ai_failed'); assert.equal(ai.error.message.includes('secret'), false); }
  const invalid = await services.saveAssessment({ assessment: fresh(), expectedUpdatedAt: undefined as unknown as null });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, 'invalid_input');
  assert.deepEqual(await store.load(), before);
  const unavailable = createRecommendationServices({ requireAdmin: async () => {}, loadStore: async () => ({ ...store, load: async () => { throw Error('database private'); } } satisfies CoreStore), suggest: async () => { throw Error(); } });
  const error = await unavailable.recommend(sampleRequest);
  assert.equal(error.ok, false);
  if (!error.ok) assert.equal(error.error.code, 'unavailable');
  const failing = createRecommendationServices({ requireAdmin: async () => {}, loadStore: async () => ({ ...store, saveAssessment: async () => { throw Error('private disk failure'); } }), suggest: async () => { throw Error(); } });
  const command = { assessment: fresh(), expectedUpdatedAt: null };
  const original = structuredClone(command);
  const failedSave = await failing.saveAssessment(command);
  assert.equal(failedSave.ok, false);
  if (!failedSave.ok) assert.equal(failedSave.error.code, 'save_failed');
  assert.deepEqual(command, original);
});

test('AI grounding accepts only exact source extracts, valid factors and integer scores; missing remains null', () => {
  const source = '삼대에 걸친 제작 기록\n지역 원료를 사용하는 작업장';
  const result = groundSuggestion(900001, source, { factors: [
    { key: 'history', score: 7, basis: '삼대에 걸친 제작 기록' },
    { key: 'locality', score: 6, basis: '지역 원료를 사용하는 작업장' },
    { key: 'story', score: 10, basis: '존재하지 않는 인증' },
    { key: 'skill', score: 8.5, basis: '제작 기록' },
    { key: 'distribution', score: 11, basis: '작업장' },
    { key: 'history', score: 10, basis: '제작 기록' },
  ] });
  assert.equal(result.factors.history.score, 7);
  assert.equal(result.factors.locality.score, 6);
  for (const key of ['story', 'skill', 'distribution'] as const) assert.equal(result.factors[key].score, null);
  assert.throws(() => groundSuggestion(1, source, { factors: [{ key: 'history', score: 8, basis: '외부 정보' }] }));
});
