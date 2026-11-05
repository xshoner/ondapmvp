import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sampleInputs, sampleRequest } from './fixtures/recommendation-inputs.ts';

test('exported server actions: isolated local save/reload/recommend/preview/conflict and production admin rejection', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ondap-core-actions-'));
  const env: Record<string, string | undefined> = process.env;
  const keys = ['ONDAP_TEST_DATA_DIR', 'ONDAP_DATA_SOURCE', 'NODE_ENV', 'ONDAP_ALLOW_LOCAL_ADMIN', 'ondap_ai'] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, env[key]]));
  t.after(async () => {
    for (const key of keys) { if (previous[key] === undefined) delete env[key]; else env[key] = previous[key]; }
    await rm(root, { recursive: true, force: true });
  });
  env.ONDAP_TEST_DATA_DIR = root;
  env.ONDAP_DATA_SOURCE = 'local';
  env.NODE_ENV = 'development';
  delete env.ONDAP_ALLOW_LOCAL_ADMIN;
  delete env.ondap_ai;
  const { products, assessments } = sampleInputs();
  await mkdir(join(root, 'config'));
  await writeFile(join(root, 'cafe24-products.json'), JSON.stringify({ products: products.map((p) => ({ ...p, image: p.imageUrl, url: p.productUrl })) }));
  await writeFile(join(root, 'config', 'engine.json'), '{}');
  const actions = await import('../src/recommendation/server.ts');
  const before = await actions.recommendForCustomer(sampleRequest);
  assert.equal(before.ok, true);
  if (before.ok) assert.equal(before.data.items.length, 0);
  for (const assessment of assessments) {
    const saved = await actions.saveProductAssessment({ assessment, expectedUpdatedAt: null });
    assert.equal(saved.ok, true);
    if (!saved.ok) continue;
    const reloaded = await actions.loadProductAssessment(assessment.productNo);
    assert.deepEqual(reloaded, saved);
    const conflict = await actions.saveProductAssessment({ assessment, expectedUpdatedAt: null });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.error.code, 'revision_conflict');
  }
  const result = await actions.recommendForCustomer(sampleRequest);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data.items.map((p) => p.recommendationScore), [93.5, 82.8, 92.2]);
  const workspace = await actions.loadAdminWorkspace();
  assert.equal(workspace.ok, true);
  if (workspace.ok) {
    const policy = workspace.data.policy;
    const preview = await actions.previewForAdmin({ request: sampleRequest, policy: policy.policy });
    assert.deepEqual(preview, result);
    const saved = await actions.saveCorePolicy({ policy: policy.policy, expectedUpdatedAt: policy.updatedAt });
    assert.equal(saved.ok, true);
    assert.deepEqual(await actions.loadCorePolicy(), saved);
  }
  const ai = await actions.suggestProductAssessment({ productNo: products[0].productNo, description: '원자료' });
  assert.equal(ai.ok, false);
  if (!ai.ok) assert.equal(ai.error.code, 'ai_failed');
  env.NODE_ENV = 'production';
  const denied = await actions.loadAdminWorkspace();
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, 'unauthorized');
});
