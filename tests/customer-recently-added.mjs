import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function queryRecorder(result) {
  const calls = [];
  const query = {
    is(column, value) { calls.push(['is', column, value]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    ilike(column, value) { calls.push(['ilike', column, value]); return this; },
    order(column, options) { calls.push(['order', column, options]); return this; },
    range(from, to) { calls.push(['range', from, to]); return this; },
    then(resolve) { return Promise.resolve(result).then(resolve); }
  };
  return { query, calls };
}

const source = await readFile(new URL('../product-catalogue-service.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);

const recorded = queryRecorder({ data: [{ id: 'new-product' }], count: 21, error: null });
const client = { from(table) { assert.equal(table, 'products'); return { select() { return recorded.query; } }; } };
const service = context.window.createProductCatalogueService(client);
const result = await service.list({
  visibility: 'active',
  categoryId: '',
  search: '',
  order: 'newest',
  offset: 0,
  limit: 20
});

assert.equal(result.count, 21);
assert.equal(result.rows.length, 1);
assert.equal(result.rows[0].id, 'new-product');
assert.equal(JSON.stringify(recorded.calls), JSON.stringify([
  ['is', 'deleted_at', null],
  ['eq', 'is_active', true],
  ['order', 'created_at', { ascending: false }],
  ['order', 'id', { ascending: false }],
  ['range', 0, 19]
]));

const ownerRecorded = queryRecorder({ data: [], count: 0, error: null });
const ownerClient = { from() { return { select() { return ownerRecorded.query; } }; } };
await context.window.createProductCatalogueService(ownerClient).list({
  visibility: 'all',
  categoryId: 'category-1',
  search: 'Pen',
  offset: 20,
  limit: 20
});
assert.equal(JSON.stringify(ownerRecorded.calls), JSON.stringify([
  ['is', 'deleted_at', null],
  ['eq', 'category_id', 'category-1'],
  ['ilike', 'name', '%Pen%'],
  ['order', 'created_at', { ascending: true }],
  ['order', 'id', { ascending: true }],
  ['range', 20, 39]
]));

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
assert.match(app, />Recently Added<\/button>/);
assert.match(app, /order: 'newest'/);
assert.doesNotMatch(app, /data-customer-category="">All<\/button>/);

console.log('Customer Recently Added catalogue contract passed.');
