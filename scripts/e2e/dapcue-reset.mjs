import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = join(import.meta.dirname, '..', '..');
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  for (const file of readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(root, 'supabase/migrations', file), 'utf8'));
  }
  await db.exec(readFileSync(join(root, 'supabase/seed.sql'), 'utf8'));
  await db.exec(`insert into public.product_evidence(product_no,reviewed) values (11,true);
    insert into public.designs(code,product_no,product_name,quantity,style_name) values ('OD-AAAA-AAAA',11,'old',1,'test');`);
  const sql = readFileSync(join(root, 'docs/dapcue-reset-rehearsal.sql'), 'utf8');
  const count = async (table) => Number((await db.query(`select count(*) as n from public.${table}`)).rows[0].n);
  const before = await count('products');
  assert.ok(before > 0);
  const styles = await count('packaging_styles');
  await assert.rejects(db.exec(sql), /격리 DB 리허설 확인값/);
  await db.exec('rollback');
  await db.exec("select set_config('ondap.rehearsal','isolated-dapcue',false)");
  await db.exec(sql);
  assert.equal(await count('products'), before);
  assert.equal(await count('designs'), 1);
  await db.exec("update public.products set url='https://dapcue.cafe24.com/product/detail.html?product_no=11' where product_no=11");
  await assert.rejects(db.exec(sql), /기존 상품 출처/);
  await db.exec('rollback');
  await db.exec("update public.products set url='https://axopenlab.cafe24.com/product/detail.html?product_no=11' where product_no=11");
  await db.exec(sql.replace(/rollback;\s*$/, 'commit;'));
  for (const table of ['products', 'product_evidence', 'product_attributes', 'product_attributes_history', 'designs']) assert.equal(await count(table), 0, table);
  assert.equal(await count('packaging_styles'), styles);
  assert.equal(await count('engine_config'), 1);
  console.log('PASS: rehearsal guard, rollback, mixed-mall rejection, isolated reset, audit history and shared assets');
} finally {
  await db.close();
}
