import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from '../src/lib/paths.ts';

const dir = join(projectRoot, 'supabase');
const setup = readFileSync(join(dir, 'setup.sql'), 'utf8');

test('setup.sql에 모든 마이그레이션과 seed가 최신 내용으로 들어 있다 (아니면 npm run db:setup-sql)', () => {
  const files = readdirSync(join(dir, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.ok(setup.includes(readFileSync(join(dir, 'migrations', f), 'utf8').trimEnd()), `빠졌거나 옛 내용: ${f}`);
  }
  assert.ok(setup.includes(readFileSync(join(dir, 'seed.sql'), 'utf8').trimEnd()), '빠졌거나 옛 내용: seed.sql');
});

test('setup.sql은 마이그레이션을 파일 이름 순서대로 담는다', () => {
  const order = [...setup.matchAll(/^-- =+ migrations\/(\S+) =+$/gm)].map((m) => m[1]);
  assert.deepEqual(order, [...order].sort());
});
