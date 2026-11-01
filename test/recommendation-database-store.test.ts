import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDatabaseCoreStore } from '../src/recommendation/database-store.ts';
import { createDraftPolicy } from '../src/recommendation/policy.ts';
import { sampleInputs } from './fixtures/recommendation-inputs.ts';

// Query-level substitute: checks conditional writes and RLS error handling, not PostgreSQL/RLS integration.
function databaseFixture() {
  type Row = Record<string, any>;
  const { products, assessments } = sampleInputs();
  const stamp = '2026-11-01T00:00:00.000Z';
  const tables: Record<string, Row[]> = {
    products: products.map((p) => ({ product_no: p.productNo, name: p.name, price: p.price, display: p.display, selling: p.selling, sold_out: p.soldOut, image: p.imageUrl, detail_image: null, url: p.productUrl })),
    product_evidence: assessments.map((a) => ({ product_no: a.productNo, description: a.description, factors: a.factors, reviewed: a.reviewed, updated_at: stamp, reviewed_at: stamp, reviewed_by: 'original-operator' })),
    engine_config: [{ id: 'active', config: { unrelated: 'preserve', coreRecommendation: createDraftPolicy() }, updated_at: stamp }],
  };
  const writes: { table: string; op: string; filters: [string, unknown][] }[] = [];
  let denyWrites = false;
  function client(writable: boolean) {
    return { from(table: string) {
      let op = 'read', payload: Row = {}, single = false, start = 0, end = Infinity;
      const filters: [string, unknown][] = [];
      const q = {
        select(_columns: string) { return q; },
        order(_column: string) { return q; },
        range(from: number, to: number) { start = from; end = to; return q; },
        eq(column: string, value: unknown) { filters.push([column, value]); return q; },
        insert(row: Row) { op = 'insert'; payload = row; return q; },
        update(row: Row) { op = 'update'; payload = row; return q; },
        single() { single = true; return q; },
        maybeSingle() { single = true; return q; },
        then(resolve: (result: { data: Row[] | Row | null; error: { code: string; message: string } | null }) => unknown) {
          const matching = (r: Row) => filters.every(([key, value]) => r[key] === value);
          let rows = tables[table].filter(matching);
          if (op !== 'read') {
            writes.push({ table, op, filters: [...filters] });
            if (!writable || denyWrites) return Promise.resolve(resolve({ data: null, error: { code: '42501', message: 'RLS denied' } }));
            if (op === 'insert') {
              if (tables[table].some((r) => r.product_no === payload.product_no)) return Promise.resolve(resolve({ data: null, error: { code: '23505', message: 'unique conflict' } }));
              const inserted = structuredClone(payload); tables[table].push(inserted); rows = [inserted];
            } else { for (const row of rows) Object.assign(row, structuredClone(payload)); }
          }
          const selected = structuredClone(rows.slice(start, end + 1));
          return Promise.resolve(resolve({ data: single ? selected[0] ?? null : selected, error: null }));
        },
      };
      return q;
    } } as unknown as SupabaseClient;
  }
  return { tables, writes, reader: client(false), writer: client(true), deny: () => { denyWrites = true; } };
}

test('database core: recommendation reads only catalog, v2 evidence and policy; no writer cannot save', async () => {
  const f = databaseFixture();
  const readOnly = createDatabaseCoreStore(f.reader);
  const data = await readOnly.load();
  assert.equal(data.products.length, 3);
  assert.equal(data.assessments.length, 3);
  f.tables.products[0].price = null;
  assert.equal(Number.isNaN((await readOnly.load()).products[0].price), true);
  await assert.rejects(readOnly.saveAssessment(data.assessments[0], data.assessments[0].updatedAt), { code: 'unauthorized' });
  assert.equal(f.writes.length, 0);
});

test('database core: competing assessment updates compare product and timestamp in the write itself', async () => {
  const f = databaseFixture();
  const stores = [createDatabaseCoreStore(f.reader, f.writer), createDatabaseCoreStore(f.reader, f.writer)];
  const assessment = (await stores[0].load()).assessments[0];
  const results = await Promise.allSettled(stores.map((store, i) => store.saveAssessment({ ...assessment, description: `edit ${i}` }, assessment.updatedAt)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected')?.reason.code, 'revision_conflict');
  for (const write of f.writes) assert.deepEqual(write.filters, [['product_no', assessment.productNo], ['updated_at', assessment.updatedAt]]);
});

test('database core: concurrent first inserts conflict rather than upsert; denied writes do not alter evidence', async () => {
  const f = databaseFixture();
  f.tables.product_evidence = [];
  const store = createDatabaseCoreStore(f.reader, f.writer);
  const input = sampleInputs().assessments[0];
  const results = await Promise.allSettled([store.saveAssessment(input, null), store.saveAssessment(input, null)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected')?.reason.code, 'revision_conflict');
  const before = structuredClone(f.tables.product_evidence);
  f.deny();
  await assert.rejects(store.saveAssessment({ ...(await store.load()).assessments[0], description: 'must not persist' }, before[0].updated_at), { code: 'save_failed' });
  assert.deepEqual(f.tables.product_evidence, before);
});

test('database core: competing policy updates preserve unrelated config and compare timestamp', async () => {
  const f = databaseFixture();
  const store = createDatabaseCoreStore(f.reader, f.writer);
  const original = (await store.load()).policy;
  const results = await Promise.allSettled([store.savePolicy(original.policy, original.updatedAt), store.savePolicy({ ...original.policy, version: 'another' }, original.updatedAt)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected')?.reason.code, 'revision_conflict');
  assert.equal(f.tables.engine_config[0].config.unrelated, 'preserve');
  for (const write of f.writes) assert.deepEqual(write.filters, [['id', 'active'], ['updated_at', original.updatedAt]]);
});
