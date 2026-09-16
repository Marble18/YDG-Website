// Local-only PostgreSQL regression: no Supabase credentials or network connections.
// Setup: npm install --prefix .codex-tmp/rounding-validation --no-package-lock @electric-sql/pglite
// Run: node tests/category-price-rounding.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.codex-tmp/rounding-validation/node_modules/@electric-sql/pglite/dist/index.js';

export const category = '00000000-0000-0000-0000-000000000001';
export const owner = '00000000-0000-0000-0000-000000000011';
export async function createFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.profiles(id uuid primary key, role text, is_active boolean);
    insert into public.profiles values
      ('${owner}', 'owner', true),
      ('00000000-0000-0000-0000-000000000012', 'staff', true),
      ('00000000-0000-0000-0000-000000000013', 'staff', false),
      ('00000000-0000-0000-0000-000000000014', 'customer', true),
      ('00000000-0000-0000-0000-000000000015', 'owner', false);
    -- Model the existing auth.uid/profile authorization contract in this isolated fixture.
    create function public.is_owner_or_staff() returns boolean language sql stable security definer as
      $$ select exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('owner','staff')) $$;
    create table public.products(
      id uuid primary key, name text, category_id uuid, sales_mode text,
      pcs_price numeric check(pcs_price >= 0), box_price numeric check(box_price >= 0),
      pieces_per_box integer, minimum_pcs_quantity integer default 1, minimum_box_quantity integer default 1,
      unit text, price numeric, minimum_order_quantity integer,
      is_active boolean default true, deleted_at timestamptz, updated_at timestamptz
    );
    alter table public.products enable row level security;
  `);
  const prior = await readFile(new URL('../supabase/migrations/202609070001_production_pcs_box_ordering.sql', import.meta.url), 'utf8');
  await db.exec(prior.slice(prior.indexOf('create or replace function public.sync_product_sales_compatibility()'), prior.indexOf('alter table public.cart_items')));
  await seed(db);
  const before = await snapshot(db);
  const migration = await readFile(new URL('../supabase/migrations/202609160001_category_whole_mmk_rounding.sql', import.meta.url), 'utf8');
  await db.exec(migration); await db.exec(migration);
  assert.deepEqual(await snapshot(db), before, 'migration is idempotent and does not mutate prices');
  return db;
}
export async function seed(db) {
  await db.exec(`reset role; truncate public.products;
    insert into public.products(id,name,category_id,sales_mode,pcs_price,box_price,pieces_per_box,is_active,deleted_at)
    values
      ('00000000-0000-0000-0000-000000000021','Pcs','${category}','pcs_only',13574,null,null,true,null),
      ('00000000-0000-0000-0000-000000000022','Box','${category}','box_only',null,13575,12,true,null),
      ('00000000-0000-0000-0000-000000000023','Both','${category}','pcs_and_box',13575,13574,12,true,null),
      ('00000000-0000-0000-0000-000000000024','Inactive','${category}','pcs_only',1234,null,null,false,null),
      ('00000000-0000-0000-0000-000000000025','Deleted','${category}','pcs_only',1234,null,null,true,now()),
      ('00000000-0000-0000-0000-000000000026','Other','00000000-0000-0000-0000-000000000002','pcs_only',1234,null,null,true,null);
  `);
}
export async function asUser(db, user = owner, role = 'authenticated') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
}
export async function snapshot(db) {
  await db.exec('reset role');
  return (await db.query('select * from public.products order by id')).rows;
}
export async function rpc(db, name, percentage) {
  assert.ok(['preview_product_category_prices','adjust_product_category_prices'].includes(name));
  return (await db.query(`select public.${name}($1::uuid,$2::numeric) as result`, [category, percentage])).rows[0].result;
}
async function run() {
  const db = await createFixture();
  try {
    for (const [price, percentage, expected] of [[1357.4,0,1357],[1357.5,0,1358],[1000,35.74,1357],[1000,35.75,1358],[13575,-90,1358],[0,10000,0]]) {
      const result = await db.query('select public.category_adjusted_price($1::numeric,$2::numeric) as price',[price,percentage]);
      assert.equal(Number(result.rows[0].price), expected);
    }
    for (const percentage of [10, -10, -90, 0, -100, 10000]) {
      await seed(db); const before = await snapshot(db); await asUser(db);
      const preview = await rpc(db,'preview_product_category_prices',percentage);
      assert.equal(preview.product_count,3); assert.equal(preview.rounding_rule,'whole_mmk_v1');
      assert.deepEqual(await snapshot(db),before,'preview is read-only');
      await asUser(db); assert.equal(await rpc(db,'adjust_product_category_prices',percentage),3);
      const after = await snapshot(db);
      for (let i=0;i<3;i++) {
        const sample=preview.samples.find(p=>p.id===after[i].id);
        for (const field of ['pcs_price','box_price']) {
          assert.equal(after[i][field]===null ? null : Number(after[i][field]),sample['adjusted_'+field]);
          if(after[i][field]!==null) assert.ok(Number.isInteger(Number(after[i][field])) && Number(after[i][field])>=0);
        }
        assert.equal(after[i].price,after[i].sales_mode==='box_only'?after[i].box_price:after[i].pcs_price);
        if(percentage===0) assert.equal(after[i].price,before[i].price);
      }
      assert.deepEqual(after.slice(3),before.slice(3),'inactive/deleted/other category unchanged');
    }
    await seed(db);
    for(const user of [owner,'00000000-0000-0000-0000-000000000012']) {
      await asUser(db,user); assert.equal(await rpc(db,'adjust_product_category_prices',0),3);
    }
    const protectedBefore=await snapshot(db);
    for(const user of ['00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000015','']) {
      await asUser(db,user);
      for(const fn of ['preview_product_category_prices','adjust_product_category_prices']) await assert.rejects(rpc(db,fn,10),e=>e.code==='42501');
    }
    await asUser(db,'','anon');
    await assert.rejects(rpc(db,'adjust_product_category_prices',10),e=>e.code==='42501');
    await assert.rejects(rpc(db,'preview_product_category_prices',10),e=>e.code==='42501');
    await asUser(db);
    for(const value of [null,-100.01,10000.01,'NaN','Infinity','-Infinity']) {
      for(const fn of ['preview_product_category_prices','adjust_product_category_prices']) await assert.rejects(rpc(db,fn,value),e=>e.code==='22023');
    }
    assert.deepEqual(await snapshot(db),protectedBefore);
    await db.exec("alter table public.products add constraint forced_failure check(name <> 'Both' or pcs_price < 15000)");
    await asUser(db); await assert.rejects(rpc(db,'adjust_product_category_prices',100),e=>e.code==='23514');
    assert.deepEqual(await snapshot(db),protectedBefore,'constraint failure rolls back the entire update');
    await db.exec('alter table public.products drop constraint forced_failure');
    // Preview is advisory: confirm recomputes current database values rather than trusting preview rows.
    await asUser(db); await rpc(db,'preview_product_category_prices',10);
    await db.exec("reset role; update public.products set pcs_price=2000 where name='Pcs'");
    await asUser(db); await rpc(db,'adjust_product_category_prices',10);
    assert.equal(Number((await snapshot(db))[0].pcs_price),2200);
    console.log('PASS: migration twice/no price mutation; numeric half-up; increase/reduce/zero; all sales modes/nulls; preview parity/read-only; auth denial; active-only; compatibility trigger; atomic rollback; current-price recomputation.');
  } finally { await db.close(); }
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/category-price-rounding.mjs')) await run();
