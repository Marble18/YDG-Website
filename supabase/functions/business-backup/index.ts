import JSZip from 'npm:jszip@3.10.1'
import { corsHeaders, json } from '../_shared/http.ts'
import { adminClient, publicClient, userClient } from '../_shared/supabase.ts'
import { backupRead, READ_ACTIONS } from './backup-read.ts'

const FORMAT_VERSION = 'ydg-business-backup-v1'
const SCHEMA_VERSION = '202609070001'
const MAX_RESTORE_BYTES = 12 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024
const ARCHIVE_PART_BYTES = 16 * 1024 * 1024
const MAX_ARCHIVE_REQUEST_BYTES = MAX_ARCHIVE_BYTES + 1024 * 1024
const TABLES = ['categories', 'products', 'profiles', 'orders', 'order_items', 'cart_items',
  'inventory_movements', 'voucher_settings', 'app_settings', 'delivery_proofs']
const BUCKETS = ['product-images', 'delivery-proofs']

class BackupError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'BackupError'
    this.code = code
    this.status = status
  }
}

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


type ManifestEntry = { bucket: string; path: string; size: number; mimeType: string; updatedAt: string | null; checksum?: string }


function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function checksum(value: unknown) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))
}

async function bytesChecksum(value: ArrayBuffer) {
  return hex(await crypto.subtle.digest('SHA-256', value))
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


type ValidatedArchive = {
  file: File
  bytes: ArrayBuffer
  checksum: string
  manifest: Record<string, any>
  objects: ManifestEntry[]
  zip: JSZip
}

function safeStoragePath(path: string) {
  return path.length > 0 && path.length <= 512 && !path.startsWith('/') && !path.includes('\\') &&
    !path.split('/').some((part) => !part || part === '.' || part === '..') &&
    !/[\u0000-\u001f\u007f]/.test(path)
}

function approvedMime(bucket: string, mimeType: string) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp']
  return BUCKETS.includes(bucket) && allowed.includes(mimeType.toLowerCase())
}

function matchesImageSignature(bytes: ArrayBuffer, mimeType: string, path: string) {
  const value = new Uint8Array(bytes)
  const lowerPath = path.toLowerCase()
  if (mimeType === 'image/jpeg') return /\.(jpe?g|jfif)$/.test(lowerPath) && value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff
  if (mimeType === 'image/png') return lowerPath.endsWith('.png') && value.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => value[index] === byte)
  if (mimeType === 'image/webp') return lowerPath.endsWith('.webp') && value.length >= 12 &&
    String.fromCharCode(...value.slice(0, 4)) === 'RIFF' && String.fromCharCode(...value.slice(8, 12)) === 'WEBP'
  return false
}

function centralDirectoryEntries(bytes: ArrayBuffer) {
  const view = new DataView(bytes)
  let eocd = -1
  for (let offset = Math.max(0, bytes.byteLength - 65557); offset <= bytes.byteLength - 22; offset++) {
    if (view.getUint32(offset, true) === 0x06054b50) eocd = offset
  }
  if (eocd < 0) throw new Error('Storage archive is malformed or incomplete')
  const totalEntries = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const names: string[] = []
  let totalUncompressed = 0
  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Storage archive directory is malformed')
    const flags = view.getUint16(offset + 8, true)
    if (flags & 1) throw new Error('Encrypted ZIP entries are not supported')
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    if (offset + 46 + nameLength + extraLength + commentLength > bytes.byteLength) throw new Error('Storage archive entry is malformed')
    names.push(decoder.decode(new Uint8Array(bytes, offset + 46, nameLength)))
    totalUncompressed += uncompressedSize
    if (totalUncompressed > MAX_ARCHIVE_BYTES) throw new Error('Uncompressed Storage archive exceeds the 40 MB safety limit')
    offset += 46 + nameLength + extraLength + commentLength
  }
  const normalized = names.filter((name) => !name.endsWith('/')).map((name) => name.toLowerCase())
  if (new Set(normalized).size !== normalized.length) throw new Error('Storage archive contains duplicate or conflicting paths')
  return names
}

async function validateStorageArchive(file: File): Promise<ValidatedArchive> {
  if (!(file instanceof File) || file.size === 0) throw new Error('Choose a non-empty YDG private Storage ZIP archive')
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Storage archive must be 40 MB or smaller')
  if (!/\.zip$/i.test(file.name) || !['application/zip', 'application/x-zip-compressed', 'application/octet-stream', ''].includes(file.type)) {
    throw new Error('Choose a YDG .zip private Storage archive')
  }
  const bytes = await file.arrayBuffer()
  const centralNames = centralDirectoryEntries(bytes)
  let zip: JSZip
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false }) }
  catch (_) { throw new Error('Storage archive ZIP or CRC validation failed') }
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new Error('Storage archive manifest.json is missing')
  let manifest: Record<string, any>
  try { manifest = JSON.parse(await manifestFile.async('text')) }
  catch (_) { throw new Error('Storage archive manifest is malformed') }
  if (manifest.formatVersion !== 'ydg-storage-archive-v1' || manifest.schemaVersion !== SCHEMA_VERSION || !Array.isArray(manifest.objects)) {
    throw new Error('Storage archive version or manifest is incompatible')
  }
  if (manifest.integrity?.algorithm !== 'SHA-256' || !/^[0-9a-f]{64}$/.test(manifest.integrity?.checksum ?? '')) throw new Error('Storage archive manifest checksum is missing')
  const manifestCore = { application: manifest.application, formatVersion: manifest.formatVersion, schemaVersion: manifest.schemaVersion, createdAt: manifest.createdAt, createdBy: manifest.createdBy, partNumber: manifest.partNumber, partCount: manifest.partCount, objects: manifest.objects }
  if (await checksum(manifestCore) !== manifest.integrity.checksum) throw new Error('Storage archive manifest checksum verification failed')

  const objects: ManifestEntry[] = []
  const paths = new Set<string>()
  let totalBytes = 0
  for (const raw of manifest.objects) {
    const bucket = String(raw?.bucket ?? '')
    const path = String(raw?.path ?? '')
    const mimeType = String(raw?.mimeType ?? '').toLowerCase()
    const size = Number(raw?.size)
    const objectChecksum = String(raw?.checksum ?? '')
    const key = `${bucket}/${path}`
    if (!BUCKETS.includes(bucket)) throw new Error('Storage archive contains an unknown bucket')
    if (!safeStoragePath(path)) throw new Error('Storage archive contains an unsafe object path')
    if (!approvedMime(bucket, mimeType)) throw new Error('Storage archive contains an unapproved file type')
    const maxSize = bucket === 'product-images' ? 500 * 1024 : 5 * 1024 * 1024
    if (!Number.isSafeInteger(size) || size < 0 || size > maxSize) throw new Error('Storage archive contains an oversized or invalid file')
    if (!/^[0-9a-f]{64}$/.test(objectChecksum)) throw new Error('Storage object checksum is missing or invalid')
    if (paths.has(key.toLowerCase())) throw new Error('Storage archive manifest contains duplicate or conflicting paths')
    paths.add(key.toLowerCase())
    const zipEntry = zip.file(key)
    if (!zipEntry) throw new Error('Storage archive object is missing from the ZIP')
    const objectBytes = await zipEntry.async('arraybuffer')
    if (objectBytes.byteLength !== size || await bytesChecksum(objectBytes) !== objectChecksum) throw new Error('Storage object size or checksum verification failed')
    if (!matchesImageSignature(objectBytes, mimeType, path)) throw new Error('Storage object content does not match its approved image type')
    totalBytes += size
    if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('Storage archive exceeds the 40 MB safety limit')
    objects.push({ bucket, path, size, mimeType, updatedAt: raw.updatedAt ?? null, checksum: objectChecksum })
  }
  const expectedNames = new Set(['manifest.json', ...objects.map((entry) => `${entry.bucket}/${entry.path}`)].map((name) => name.toLowerCase()))
  for (const name of centralNames) {
    if (name.endsWith('/')) continue
    if (!safeStoragePath(name) || !expectedNames.has(name.toLowerCase())) throw new Error('Storage archive contains an unlisted or unsafe file')
  }
  if (expectedNames.size !== centralNames.filter((name) => !name.endsWith('/')).length) throw new Error('Storage archive file list conflicts with its manifest')
  return { file, bytes, checksum: manifest.integrity.checksum, manifest, objects, zip }
}

async function existingObject(admin: ReturnType<typeof adminClient>, entry: ManifestEntry) {
  const slash = entry.path.lastIndexOf('/')
  const folder = slash < 0 ? '' : entry.path.slice(0, slash)
  const name = slash < 0 ? entry.path : entry.path.slice(slash + 1)
  const { data, error } = await admin.storage.from(entry.bucket).list(folder, { limit: 100, search: name })
  if (error) throw new Error('Storage objects could not be inspected')
  return (data ?? []).some((item) => item.id && item.name === name)
}

async function classifyArchive(admin: ReturnType<typeof adminClient>, archive: ValidatedArchive) {
  const files: Record<string, unknown>[] = []
  const counts = { create: 0, skip: 0, conflict: 0, invalid: 0, total: archive.objects.length }
  let totalBytes = 0
  for (const entry of archive.objects) {
    totalBytes += entry.size
    if (!await existingObject(admin, entry)) {
      counts.create++
      files.push({ bucket: entry.bucket, path: entry.path, action: 'create', size: entry.size })
      continue
    }
    const { data, error } = await admin.storage.from(entry.bucket).download(entry.path)
    if (error || !data) throw new Error('An existing Storage object could not be validated')
    const same = await bytesChecksum(await data.arrayBuffer()) === entry.checksum
    counts[same ? 'skip' : 'conflict']++
    files.push({ bucket: entry.bucket, path: entry.path, action: same ? 'skip' : 'conflict', size: entry.size })
  }
  return { counts, totalBytes, files }
}

async function createStorageRestorePlan(auth: Awaited<ReturnType<typeof requirePrimaryOwner>>, archive: ValidatedArchive) {
  if (!auth) throw new Error('Active primary owner access is required')
  const preview = await classifyArchive(auth.admin, archive)
  await auth.admin.from('business_restore_plans').delete().lt('expires_at', new Date().toISOString())
  await auth.admin.from('business_restore_plans').delete().not('consumed_at', 'is', null)
  const { data, error } = await auth.admin.from('business_restore_plans').insert({
    owner_id: auth.ownerId, backup_checksum: archive.checksum, backup_type: 'storage', preview,
  }).select('id, expires_at').single()
  if (error || !data) throw new Error('Storage restore preview could not be created')
  return { planId: data.id, expiresAt: data.expires_at, mode: 'merge', overwrite: false, ...preview }
}

async function restoreStorageArchive(auth: NonNullable<Awaited<ReturnType<typeof requirePrimaryOwner>>>, archive: ValidatedArchive, planId: string) {
  const { data: plan } = await auth.admin.from('business_restore_plans').select('*')
    .eq('id', planId).eq('owner_id', auth.ownerId).eq('backup_type', 'storage').maybeSingle()
  if (!plan || plan.backup_checksum !== archive.checksum || plan.consumed_at || Date.parse(plan.expires_at) < Date.now()) throw new Error('Storage restore preview expired or does not match this archive')
  const { data: prior } = await auth.admin.from('business_restore_audit').select('result_summary')
    .eq('backup_checksum', archive.checksum).eq('backup_type', 'storage').maybeSingle()
  if (prior) return { alreadyRestored: true, ...prior.result_summary }

  const created: Record<string, unknown>[] = []
  const skipped: Record<string, unknown>[] = []
  const conflicts: Record<string, unknown>[] = []
  const failed: Record<string, unknown>[] = []
  for (const entry of archive.objects) {
    try {
      if (await existingObject(auth.admin, entry)) {
        const { data, error } = await auth.admin.storage.from(entry.bucket).download(entry.path)
        if (error || !data) throw new Error('Existing object could not be checked')
        const same = await bytesChecksum(await data.arrayBuffer()) === entry.checksum
        ;(same ? skipped : conflicts).push({ bucket: entry.bucket, path: entry.path })
        continue
      }
      const zipEntry = archive.zip.file(`${entry.bucket}/${entry.path}`)
      if (!zipEntry) throw new Error('Archive object is missing')
      const objectBytes = await zipEntry.async('uint8array')
      const { error } = await auth.admin.storage.from(entry.bucket).upload(entry.path, objectBytes, { contentType: entry.mimeType, upsert: false })
      if (error) {
        if (await existingObject(auth.admin, entry)) skipped.push({ bucket: entry.bucket, path: entry.path, reason: 'Created by a concurrent restore' })
        else throw new Error('Upload failed')
      } else created.push({ bucket: entry.bucket, path: entry.path })
    } catch (error) {
      failed.push({ bucket: entry.bucket, path: entry.path, error: error instanceof Error ? error.message : 'Restore failed' })
    }
  }
  const summary = { created, skipped, conflicts, failed, total: archive.objects.length, totalBytes: archive.objects.reduce((sum, entry) => sum + entry.size, 0) }
  if (!failed.length) {
    await auth.admin.from('business_restore_plans').update({ consumed_at: new Date().toISOString() }).eq('id', planId).eq('owner_id', auth.ownerId)
    const { error } = await auth.admin.from('business_restore_audit').insert({ owner_id: auth.ownerId, backup_checksum: archive.checksum, backup_type: 'storage', format_version: 'ydg-storage-archive-v1', result_summary: summary })
    if (error && error.code !== '23505') throw new Error('Storage restore audit could not be saved')
  }
  return { alreadyRestored: false, partialFailure: failed.length > 0, ...summary }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
  try {
    const auth = await requirePrimaryOwner(request)
    if (!auth) return json({ ok: false, error: 'Active primary owner access is required.' }, 403)
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (contentLength > MAX_ARCHIVE_REQUEST_BYTES) return json({ ok: false, error: 'Backup request is too large.' }, 413)
    const isForm = (request.headers.get('content-type') ?? '').toLowerCase().includes('multipart/form-data')
    const form = isForm ? await request.formData() : null
    const body: Record<string, any> = isForm ? {} : await request.json()
    const action = String(form?.get('action') ?? body.action ?? '')
    if (!isForm && contentLength > MAX_RESTORE_BYTES && ['preview-restore', 'confirm-restore'].includes(action)) {
      return json({ ok: false, error: 'Database backup request is too large.' }, 413)
    }

    if (READ_ACTIONS.includes(action)) {
      const started=Date.now()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const value=await Promise.race([
          backupRead(adminClient((input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) })),auth.ownerId,body,new URL(Deno.env.get('SUPABASE_URL')!).hostname.split('.')[0]),
          new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new BackupError('BACKUP_READ_TIMEOUT','This backup read timed out. Retry this page; no data was changed.',504)),15000)})
        ])
        console.info(JSON.stringify({event:'backup-read',action,status:200,elapsedMs:Date.now()-started}))
        if(value instanceof Blob) return new Response(value,{headers:{...corsHeaders,'Content-Type':'application/octet-stream','Cache-Control':'no-store'}})
        return json({ok:true,result:value})
      } catch(error) {
        const code=error instanceof BackupError?error.code:String((error as any)?.code??'BACKUP_READ_FAILED')
        console.error(JSON.stringify({event:'backup-read',action,code,elapsedMs:Date.now()-started}))
        throw new BackupError(code,'Backup read did not complete. Retry this step; no data was changed.',Number((error as any)?.status)||503)
      } finally {if(timer) clearTimeout(timer)}
    }
    if (['create-database-backup','inspect-storage-backup','create-storage-archive'].includes(action)) {
      throw new BackupError('BACKUP_CLIENT_UPDATE_REQUIRED','Refresh to use the bounded backup workflow. No backup or restore metadata was written.',409)
    }
    if(action==='validate-database-only') {
      const validated=await validateBackup(body.backup)
      for(const table of TABLES) {
        const rows=validated.backup.data[table]
        if(rows.length!==validated.backup.metadata.tableCounts?.[table]||new Set(rows.map((r:any)=>r.id)).size!==rows.length) throw new BackupError('BACKUP_COUNTS_INVALID','Backup counts or row identities do not match.')
      }
      return json({ok:true,result:{valid:true,checksum:validated.checksum,tableCounts:validated.backup.metadata.tableCounts,restoreExecuted:false}})
    }
    if(action==='validate-storage-only') {
      const value=form?.get('archive')
      if(!(value instanceof File)) throw new BackupError('STORAGE_ARCHIVE_INVALID','Choose an archive file.')
      const archive=await validateStorageArchive(value)
      return json({ok:true,result:{valid:true,checksum:archive.checksum,fileCount:archive.objects.length,restoreExecuted:false}})
    }

    if (action === 'preview-storage-restore' || action === 'confirm-storage-restore') {
      const archiveValue = form?.get('archive')
      if (!(archiveValue instanceof File)) return json({ ok: false, error: 'Private Storage ZIP archive is required.' }, 400)
      let archive: ValidatedArchive
      try { archive = await validateStorageArchive(archiveValue) }
      catch (error) { throw new BackupError('STORAGE_ARCHIVE_INVALID', error instanceof Error ? error.message : 'Storage archive validation failed.') }
      const result = action === 'preview-storage-restore'
        ? await createStorageRestorePlan(auth, archive)
        : await restoreStorageArchive(auth, archive, String(form?.get('planId') ?? ''))
      return json({ ok: true, result })
    }

    if (action === 'preview-restore' || action === 'confirm-restore') {
      let validated: Awaited<ReturnType<typeof validateBackup>>
      try { validated = await validateBackup(body.backup) }
      catch (error) { throw new BackupError('DATABASE_BACKUP_INVALID', error instanceof Error ? error.message : 'Database backup validation failed.') }
      const rpc = action === 'preview-restore'
        ? await auth.userDb.rpc('preview_business_restore', { p_payload: validated.core, p_checksum: validated.checksum })
        : await auth.userDb.rpc('restore_business_backup', { p_plan_id: body.planId, p_payload: validated.core, p_checksum: validated.checksum })
      if (rpc.error) throw rpc.error
      return json({ ok: true, result: rpc.data })
    }
    return json({ ok: false, error: 'Unknown backup action.' }, 400)
  } catch (error) {
    const code = error instanceof BackupError ? error.code : 'BACKUP_OPERATION_FAILED'
    const status = error instanceof BackupError ? error.status : 400
    const message = error instanceof Error ? error.message : 'The secure backup service could not complete this operation.'
    console.error(JSON.stringify({ event: 'business-backup-failed', code }))
    return json({ ok: false, code, error: message }, status)
  }
})
