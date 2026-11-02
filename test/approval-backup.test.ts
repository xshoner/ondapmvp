import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_TABLES, validateSnapshot, restoreSql, referencedFiles, type Snapshot } from '../src/lib/backup.ts';

test('approval backup includes new table, private images and recoverable ownership hash', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const snapshot = { schemaVersion: '20261102', capturedAt: new Date().toISOString(), tables: { ...Object.fromEntries(BACKUP_TABLES.map(t => [t, []])), product_evidence: [], formality_policies: [], approval_drafts: [{ id, creator_token_hash: 'a'.repeat(64), data: { source: { candidates: [{ localImageFilename: `${id}_27.png` }] } } }] } } as unknown as Snapshot;
  validateSnapshot(snapshot);
  assert.deepEqual(referencedFiles(snapshot, 'https://example.com'), [`approval-assets/${id}/27.png`]);
  const sql = restoreSql(snapshot);
  assert.ok(sql.includes('insert into public.approval_drafts'));
  assert.ok(sql.includes('a'.repeat(64)));
  const missing = structuredClone(snapshot); delete missing.tables.approval_drafts;
  assert.throws(() => validateSnapshot(missing));
  snapshot.tables.approval_drafts![0].id = 'another-document';
  assert.throws(() => referencedFiles(snapshot, 'https://example.com'));
});
