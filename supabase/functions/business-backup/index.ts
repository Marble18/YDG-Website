import JSZip from 'npm:jszip@3.10.1'
import { corsHeaders, json } from '../_shared/http.ts'
import { adminClient, publicClient, userClient } from '../_shared/supabase.ts'

const FORMAT_VERSION = 'ydg-business-backup-v1'
const SCHEMA_VERSION = '202608110002'
const MAX_RESTORE_BYTES = 12 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024
const TABLES = ['categories', 'products', 'profiles', 'orders', 'order_items', 'cart_items',
  'inventory_movements', 'voucher_settings', 'app_settings', 'delivery_proofs']
const BUCKETS = ['product-images', 'delivery-proofs']

async function requirePrimaryOwner(request: Request) {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: userData, error: userError } = await publicClient().auth.getUser(token)
  if (userError || !userData.user) return null
  const admin = adminClient()
  const { data: owner } = await admin.from('profiles').select('id, is_active')
    .eq('role', 'owner').order('created_at').order('id').limit(1).maybeSingle()
  if (!owner || !owner.is_active || owner.id !== userData.user.id) return null
  return { admin, userDb: userClient(token), ownerId: owner.id }
}

async function allRows(admin: ReturnType<typeof adminClient>, table: string) {
  const rows: Record<string, unknown>[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from(table).select('*').range(offset, offset + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}

type ManifestEntry = { bucket: string; path: string; size: number; mimeType: string; updatedAt: string | null; checksum?: string }

async function bucketManifest(admin: ReturnType<typeof adminClient>, bucket: string) {
  const entries: ManifestEntry[] = []
  async function walk(prefix = '', depth = 0): Promise<void> {
    if (depth > 8) throw new Error('Storage folder depth is not supported')
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw error
      for (const item of data ?? []) {
        const path = prefix ? `${prefix}/${item.name}` : item.name
        if (item.id) {
          entries.push({ bucket, path, size: Number(item.metadata?.size ?? 0), mimeType: String(item.metadata?.mimetype ?? 'application/octet-stream'), updatedAt: item.updated_at ?? null })
        } else await walk(path, depth + 1)
      }
      if (!data || data.length < 1000) break
    }
  }
  await walk()
  return entries
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function checksum(value: unknown) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))
}

async function bytesChecksum(value: ArrayBuffer) {
  return hex(await crypto.subtle.digest('SHA-256', value))
}

async function buildBackup(admin: ReturnType<typeof adminClient>, ownerId: string) {
  const data: Record<string, unknown[]> = {}
  for (const table of TABLES) data[table] = await allRows(admin, table)
  const storage = { manifests: [] as ManifestEntry[] }
  for (const bucket of BUCKETS) storage.manifests.push(...await bucketManifest(admin, bucket))
  storage.manifests.sort((a, b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`))
  const core = {
    metadata: {
      application: 'Yadanar Theingi Ecommerce', formatVersion: FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), createdBy: ownerId,
      tableCounts: Object.fromEntries(TABLES.map((table) => [table, data[table].length])),
      storageCounts: Object.fromEntries(BUCKETS.map((bucket) => [bucket, storage.manifests.filter((entry) => entry.bucket === bucket).length])),
      excludes: ['Auth passwords and hashes', 'secret keys', 'tokens', 'signed URLs', 'Storage object bytes'],
    },
    data,
    storage,
  }
  return { ...core, integrity: { algorithm: 'SHA-256', checksum: await checksum(core) } }
}

async function validateBackup(value: unknown) {
  const backup = value as Record<string, any>
  if (!backup || typeof backup !== 'object') throw new Error('Backup JSON is invalid')
  if (backup.metadata?.formatVersion !== FORMAT_VERSION || backup.metadata?.schemaVersion !== SCHEMA_VERSION) throw new Error('Backup version is incompatible')
  if (!backup.data || !backup.storage || backup.integrity?.algorithm !== 'SHA-256' || !/^[0-9a-f]{64}$/.test(backup.integrity?.checksum ?? '')) throw new Error('Backup structure is incomplete')
  for (const table of TABLES) if (!Array.isArray(backup.data[table])) throw new Error('Backup table data is incomplete')
  const core = { metadata: backup.metadata, data: backup.data, storage: backup.storage }
  if (await checksum(core) !== backup.integrity.checksum) throw new Error('Backup checksum verification failed')
  return { backup, core, checksum: backup.integrity.checksum as string }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
  try {
    const auth = await requirePrimaryOwner(request)
    if (!auth) return json({ ok: false, error: 'Active primary owner access is required.' }, 403)
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (contentLength > MAX_RESTORE_BYTES) return json({ ok: false, error: 'Backup request is too large.' }, 413)
    const body = await request.json()
    const action = String(body.action ?? '')

    if (action === 'create-database-backup') {
      const backup = await buildBackup(auth.admin, auth.ownerId)
      return new Response(JSON.stringify(backup, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="ydg-business-backup-${new Date().toISOString().slice(0, 10)}.json"` } })
    }

    if (action === 'create-storage-archive') {
      const zip = new JSZip()
      const manifest: ManifestEntry[] = []
      let totalBytes = 0
      for (const bucket of BUCKETS) manifest.push(...await bucketManifest(auth.admin, bucket))
      manifest.sort((a, b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`))
      for (const entry of manifest) {
        totalBytes += entry.size
        if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('Storage archive exceeds the 40 MB on-demand safety limit')
        const { data, error } = await auth.admin.storage.from(entry.bucket).download(entry.path)
        if (error || !data) throw new Error('A Storage object could not be archived')
        const objectBytes = await data.arrayBuffer()
        entry.checksum = await bytesChecksum(objectBytes)
        zip.file(`${entry.bucket}/${entry.path}`, new Uint8Array(objectBytes))
      }
      const manifestCore = { application: 'Yadanar Theingi Ecommerce', formatVersion: 'ydg-storage-archive-v1', schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), createdBy: auth.ownerId, objects: manifest }
      zip.file('manifest.json', JSON.stringify({ ...manifestCore, integrity: { algorithm: 'SHA-256', checksum: await checksum(manifestCore) } }, null, 2))
      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
      return new Response(bytes, { headers: { ...corsHeaders, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="ydg-storage-archive-${new Date().toISOString().slice(0, 10)}.zip"` } })
    }

    if (action === 'preview-restore' || action === 'confirm-restore') {
      const validated = await validateBackup(body.backup)
      const rpc = action === 'preview-restore'
        ? await auth.userDb.rpc('preview_business_restore', { p_payload: validated.core, p_checksum: validated.checksum })
        : await auth.userDb.rpc('restore_business_backup', { p_plan_id: body.planId, p_payload: validated.core, p_checksum: validated.checksum })
      if (rpc.error) throw rpc.error
      return json({ ok: true, result: rpc.data })
    }
    return json({ ok: false, error: 'Unknown backup action.' }, 400)
  } catch (error) {
    console.error('business-backup operation failed')
    const message = error instanceof Error ? error.message : 'Backup operation failed.'
    return json({ ok: false, error: message }, 400)
  }
})
