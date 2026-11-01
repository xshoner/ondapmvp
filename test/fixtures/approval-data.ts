import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 실제 로컬 초안이나 상품 판정 자료를 수정하지 않는 독립적인 테스트 저장소.
const dir = mkdtempSync(join(tmpdir(), 'ondap-approval-test-'));
const original = join(process.cwd(), 'data');
mkdirSync(join(dir, 'config'));
for (const file of ['cafe24-products.json', 'product-attributes.json', 'config/engine.json']) cpSync(join(original, file), join(dir, file));
const { products } = JSON.parse(readFileSync(join(dir, 'cafe24-products.json'), 'utf8'));
const factors = { skill: { level: 'high', basis: '검증 근거' }, locality: { level: 'high', basis: '검증 근거' } };
const items = Object.fromEntries(products.map((p: { productNo: number }) => [p.productNo, { productNo: p.productNo, reviewed: true, factors }]));
writeFileSync(join(dir, 'formality-pilot.json'), JSON.stringify({ products, items }));
process.env.ONDAP_TEST_DATA_DIR = dir;
