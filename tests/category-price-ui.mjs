// Local app + real category service + local PostgreSQL RPCs. No live product writes.
// Set YDG_PLAYWRIGHT_MODULE (module URL) / YDG_BROWSER_EXECUTABLE if not installed normally.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createFixture, category, asUser, snapshot, seed } from './category-price-rounding.mjs';
const { default: playwright } = await import(process.env.YDG_PLAYWRIGHT_MODULE || 'playwright');
const db = await createFixture();
const source = await readFile('app.js','utf8');
const service = await readFile('category-service.js','utf8');
const css = await readFile('styles.css','utf8');
const app = source.replace('  startApp();', `
  refreshCataloguePage = async function(message) { window.savedMessage=message; closeModal(); };
  window.qa = { open() {
    currentUser={id:'fixture-owner',role:'owner'};
    state.categories=[{id:'${category}',name:'Test category',is_active:true}];
    document.getElementById('app').innerHTML='<div id="modal-root"></div>';
    renderDatabaseCategoryAdjust();
  }};
`);
const setup = `window.YDG_SUPABASE={apiUrl:'local',publishableKey:'fixture'};
window.supabase={createClient:()=>({auth:{onAuthStateChange(){}},rpc:(name,args)=>window.localRpc(name,args)})};
['Account','Deletion','ProductCatalogue','Order','DeliveryProof','Settings','BusinessBackup'].forEach(n=>window['create'+n+'Service']=()=>({}));`;
const server=createServer((req,res)=>{
  if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript; charset=utf-8');res.end(app);}
  else if(req.url==='/category-service.js'){res.setHeader('Content-Type','application/javascript; charset=utf-8');res.end(service);}
  else if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');res.end(css);}
  else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><main id="app"></main><div id="toast"></div><script>'+setup+'</script><script src="/category-service.js"></script><script src="/app.js"></script>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await playwright.chromium.launch({headless:true,...(process.env.YDG_BROWSER_EXECUTABLE?{executablePath:process.env.YDG_BROWSER_EXECUTABLE}:{})});
let missing=false, delay=false;
const calls=[];
try {
  const page=await browser.newPage({viewport:{width:375,height:812}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('localRpc',async(name,args)=>{
    calls.push({name,args});
    assert.ok(['preview_product_category_prices','adjust_product_category_prices'].includes(name));
    if(missing)return {data:null,error:{code:'PGRST202',message:'missing preview'}};
    if(delay)await new Promise(resolve=>setTimeout(resolve,150));
    try {const result=await db.query('select public.'+name+'($1::uuid,$2::numeric) as data',[args.p_category_id,args.p_percentage]);return {data:result.rows[0].data,error:null};}
    catch(e){return {data:null,error:{code:e.code,message:e.message}};}
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  const before=await snapshot(db);await asUser(db);
  await page.evaluate(()=>window.qa.open());
  const percent=page.locator('[name="percentage"]');const button=page.locator('#apply-category-adjust');
  assert.match(await page.locator('.photo-help').innerText(),/nearest whole MMK/);
  await percent.fill('-90');missing=true;await button.click();
  await page.waitForFunction(()=>document.getElementById('category-adjust-status').textContent.includes('migration is not available'));
  assert.equal(calls.some(c=>c.name==='adjust_product_category_prices'),false);
  missing=false;await button.click();await page.waitForFunction(()=>document.getElementById('apply-category-adjust').textContent==='Confirm price change');
  assert.match(await page.locator('#category-price-preview').innerText(),/1,357 MMK/);
  assert.match(await page.locator('#category-price-preview').innerText(),/1,358 MMK/);
  assert.deepEqual(await snapshot(db),before);await asUser(db);
  // Editing the percentage invalidates the prior confirmation; next click only previews.
  await percent.fill('0');assert.equal(await button.innerText(),'Preview price change');
  await button.click();await page.waitForFunction(()=>document.getElementById('apply-category-adjust').textContent==='Confirm price change');
  assert.equal(calls.some(c=>c.name==='adjust_product_category_prices'),false);
  await percent.fill('-90');await button.click();await page.waitForFunction(()=>document.getElementById('apply-category-adjust').textContent==='Confirm price change');
  await page.screenshot({path:'.codex-tmp/category-rounding-mobile.png',fullPage:true});
  await button.click();await page.waitForFunction(()=>window.savedMessage);
  assert.equal(await page.evaluate(()=>window.savedMessage),'3 product price(s) updated.');
  assert.equal(calls.filter(c=>c.name==='adjust_product_category_prices').length,1);
  assert.equal(Number((await snapshot(db))[0].pcs_price),1357);
  // Active staff uses identical contract; customer gets a safe denial without writes.
  await seed(db);await asUser(db,'00000000-0000-0000-0000-000000000012');
  await page.evaluate(()=>window.qa.open());await percent.fill('10');await button.click();
  await page.waitForFunction(()=>document.getElementById('apply-category-adjust').textContent==='Confirm price change');
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:'.codex-tmp/category-rounding-desktop.png',fullPage:true});
  await asUser(db,'00000000-0000-0000-0000-000000000014');await button.click();
  await page.waitForFunction(()=>document.getElementById('category-adjust-status').textContent.includes('active owner or staff'));
  await asUser(db);await page.evaluate(()=>window.qa.open());
  const count=calls.length;await percent.fill('-101');await button.click();assert.equal(calls.length,count);
  // Stale async preview cannot re-enable confirmation after an input change.
  delay=true;await percent.fill('10');await button.click();await percent.fill('20');
  await page.waitForFunction(()=>!document.getElementById('apply-category-adjust').disabled);
  assert.equal(await button.innerText(),'Preview price change');assert.equal(await page.locator('#category-price-preview').innerText(),'');
  // Decimal percentages survive native validation, both service requests and SQL unchanged.
  delay=false;
  for(const percentage of [5.5,-2.5,5.555,-2.555,0.005]) {
    await seed(db);const unchanged=await snapshot(db);await asUser(db);
    await page.evaluate(()=>{window.savedMessage=null;window.qa.open();});
    await percent.fill(String(percentage));
    assert.equal(await percent.evaluate(el=>el.checkValidity()),true);
    await button.click();
    await page.waitForFunction(()=>document.getElementById('apply-category-adjust').textContent==='Confirm price change');
    assert.equal(calls.at(-1).args.p_percentage,percentage);
    const expected=Math.round(13574*(100+percentage)/100);
    assert.ok((await page.locator('#category-price-preview').innerText()).includes(expected.toLocaleString('en-US')+' MMK'));
    assert.deepEqual(await snapshot(db),unchanged);await asUser(db);
    await button.click();await page.waitForFunction(()=>window.savedMessage);
    assert.equal(calls.at(-1).name,'adjust_product_category_prices');
    assert.equal(calls.at(-1).args.p_percentage,percentage);
    const result=await snapshot(db);
    assert.equal(Number(result[0].pcs_price),expected);
    assert.equal(Number(result[1].box_price),Math.round(13575*(100+percentage)/100));
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: real UI/service + local SQL preview/confirm parity; missing migration fail-closed; no writes on preview; explicit confirmation; stale preview invalidation; validation; staff/customer authorization; desktop/mobile screenshots.');
} finally {await browser.close();server.close();await db.close();}
