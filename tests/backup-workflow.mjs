import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
globalThis.JSZip = require('../.codex-tmp/pr25-validation/node_modules/jszip')
vm.runInThisContext(await readFile(new URL('../backup-workflow.js', import.meta.url), 'utf8'), { filename: 'backup-workflow.js' })

const TABLES = ['categories','products','profiles','orders','order_items','cart_items','inventory_movements','voucher_settings','app_settings','delivery_proofs']
const BUCKETS = ['product-images','delivery-proofs']

function pngBytes(seed = 0) {
  return new Uint8Array([137,80,78,71,13,10,26,10,seed & 255])
}

function fixtureReader({ productCount = 1205, storageCount = 205, transientFailure = false, mutateSecondPass = false } = {}) {
  const data = Object.fromEntries(TABLES.map((table) => [table, table === 'products'
    ? Array.from({ length: productCount }, (_, index) => ({ id: `p-${String(index).padStart(5, '0')}`, name: `Product ${index}` }))
    : [{ id: `${table}-1` }]]))
  const storage = Array.from({ length: storageCount }, (_, index) => ({
    name: `image-${String(index).padStart(5, '0')}.png`, id: `s-${index}`,
    size: 9, mimeType: 'image/png', updatedAt: '2026-09-17T00:00:00Z'
  }))
  let failed = false
  let productPass = 0
  const calls = []
  return {
    calls,
    read: async (action, args = {}) => {
      calls.push({ action, ...args })
      if (transientFailure && action === 'backup-table-page' && !failed) {
        failed = true
        const error = new Error('temporary')
        error.status = 503
        throw error
      }
      if (action === 'backup-info') return {
        protocol: 'ydg-bounded-backup-v1', schemaVersion: '202609070001', projectRef: 'fixture', ownerId: 'owner-fixture', tables: TABLES, buckets: BUCKETS
      }
      if (action === 'backup-table-page') {
        let rows = data[args.table]
        if (args.table === 'products' && args.offset === 0) productPass += 1
        if (mutateSecondPass && args.table === 'products' && productPass >= 2) rows = rows.map((row, i) => i === 0 ? { ...row, name: 'Changed' } : row)
        const page = rows.slice(args.offset, args.offset + 200)
        return { rows: page, count: rows.length, offset: args.offset, nextOffset: args.offset + page.length, done: args.offset + page.length >= rows.length }
      }
      if (action === 'backup-storage-page') {
        const rows = args.bucket === 'product-images' && args.prefix === '' ? storage : []
        const page = rows.slice(args.offset, args.offset + 100)
        return { items: page, done: page.length < 100 }
      }
      if (action === 'backup-object') return new Blob([pngBytes(Number(args.path.match(/(\d+)/)?.[1] || 0))], { type: 'image/png' })
      throw new Error(`Unexpected action ${action}`)
    }
  }
}

async function databasePaginationAndRetry() {
  const fixture = fixtureReader({ transientFailure: true })
  const workflow = globalThis.YDGBackupWorkflow.create(fixture.read, { sleep: async () => {} })
  const backup = await workflow.database(() => {})
  assert.equal(backup.data.products.length, 1205)
  assert.equal(backup.storage.manifests.length, 0)
  assert.equal((await globalThis.YDGBackupWorkflow.validateDatabase(backup)).valid, true)
  const productPages = fixture.calls.filter((call) => call.action === 'backup-table-page' && call.table === 'products')
  assert.ok(productPages.length >= 14, 'two full product passes use bounded 200-row pages')
  assert.equal(fixture.calls.filter((call) => call.action === 'backup-storage-page').length, 0, 'database backup never waits for Storage listing')
  assert.ok(fixture.calls.every((call) => !['create-database-backup','create-storage-archive'].includes(call.action)))
}

async function changedSourceNeverCompletes() {
  const fixture = fixtureReader({ mutateSecondPass: true, storageCount: 0 })
  const workflow = globalThis.YDGBackupWorkflow.create(fixture.read, { sleep: async () => {} })
  await assert.rejects(() => workflow.database(() => {}), /changed between verification passes/)
}

async function storageResumeAndCompletion() {
  const fixture = fixtureReader({ productCount: 1, storageCount: 5 })
  let failedOnce = false
  const saved = []
  const workflow = globalThis.YDGBackupWorkflow.create(fixture.read, { sleep: async () => {} })
  await assert.rejects(() => workflow.storage(() => {}, async (_blob, filename) => {
    if (!failedOnce && filename.includes('part-2-')) { failedOnce = true; throw new Error('fixture disk failure') }
    saved.push(filename)
  }), /fixture disk failure/)
  assert.equal(workflow.hasResume(), true)
  const result = await workflow.storage(() => {}, async (_blob, filename) => saved.push(filename))
  assert.equal(result.complete, true)
  assert.equal(result.totalFiles, 5)
  assert.equal(result.partCount, 2)
  assert.equal(workflow.hasResume(), false)
  assert.equal(saved.filter((name) => name.includes('part-1-')).length, 1, 'verified part one is not regenerated after resume')
}

async function authorizationFailureIsNotRetried() {
  let attempts = 0
  const workflow = globalThis.YDGBackupWorkflow.create(async () => {
    attempts += 1
    const error = new Error('denied'); error.status = 403; throw error
  }, { sleep: async () => {} })
  await assert.rejects(() => workflow.database(() => {}), /denied/)
  assert.equal(attempts, 1)
}

await databasePaginationAndRetry()
await changedSourceNeverCompletes()
await storageResumeAndCompletion()
await authorizationFailureIsNotRetried()
console.log('backup workflow tests: ok')
