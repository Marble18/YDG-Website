import assert from 'node:assert/strict'
import { backupRead, safePath } from '../supabase/functions/business-backup/backup-read.ts'

function adminFixture() {
  const rows = Array.from({ length: 450 }, (_, index) => ({ id: index + 1 }))
  const calls = []
  const admin = {
    from(table) {
      calls.push(['from', table])
      return {
        select() { return this },
        order(column) { calls.push(['order', column]); return this },
        async range(start, end) { calls.push(['range', start, end]); return { data: rows.slice(start, end + 1), count: rows.length, error: null } }
      }
    },
    storage: { from(bucket) {
      calls.push(['bucket', bucket])
      return {
        async list(prefix, options) {
          calls.push(['list', prefix, options.limit, options.offset])
          return { data: Array.from({ length: options.offset === 0 ? 100 : 1 }, (_, index) => ({
            name: `file-${options.offset + index}.png`, id: `id-${options.offset + index}`,
            metadata: { size: 9, mimetype: 'image/png' }, updated_at: '2026-09-17T00:00:00Z'
          })), error: null }
        },
        async download(path) { calls.push(['download', path]); return { data: new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0])], { type: 'image/png' }), error: null } }
      }
    }}
  }
  return { admin, calls }
}

const { admin, calls } = adminFixture()
const info = await backupRead(admin, 'owner', { action: 'backup-info' }, 'fixture-ref')
assert.equal(info.pageSize, 200)
assert.equal(info.storagePageSize, 100)

const page = await backupRead(admin, 'owner', { action: 'backup-table-page', table: 'products', offset: 200 }, 'fixture-ref')
assert.equal(page.rows.length, 200)
assert.equal(page.nextOffset, 400)
assert.equal(page.done, false)
assert.ok(calls.some((call) => call[0] === 'order' && call[1] === 'id'))

const storagePage = await backupRead(admin, 'owner', { action: 'backup-storage-page', bucket: 'product-images', prefix: '', offset: 0 }, 'fixture-ref')
assert.equal(storagePage.items.length, 100)
assert.equal(storagePage.done, false)

const object = await backupRead(admin, 'owner', { action: 'backup-object', bucket: 'product-images', path: 'nested/test.png' }, 'fixture-ref')
assert.equal(object.size, 9)

for (const body of [
  { action: 'backup-table-page', table: 'not-approved', offset: 0 },
  { action: 'backup-storage-page', bucket: 'unknown', prefix: '', offset: 0 },
  { action: 'backup-storage-page', bucket: 'product-images', prefix: '../unsafe', offset: 0 },
  { action: 'backup-object', bucket: 'product-images', path: '/absolute.png' }
]) await assert.rejects(() => backupRead(admin, 'owner', body, 'fixture-ref'))

assert.equal(safePath('nested/photo.png'), true)
assert.equal(safePath('../photo.png'), false)
assert.equal(safePath('nested\\photo.png'), false)
assert.equal(calls.some((call) => ['insert','update','delete','upsert'].includes(call[0])), false)
console.log('backup read tests: ok')
