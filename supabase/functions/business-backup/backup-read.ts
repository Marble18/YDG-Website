// Stateless, bounded, primary-owner-only backup reads. No writes or restore plans.
export const BACKUP_TABLES = ['categories','products','profiles','orders','order_items','cart_items','inventory_movements','voucher_settings','app_settings','delivery_proofs']
export const BACKUP_BUCKETS = ['product-images','delivery-proofs']
export const READ_ACTIONS = ['backup-info','backup-table-page','backup-storage-page','backup-object']
export function safePath(path: string, allowEmpty = false) {
  return (allowEmpty && path === '') || (path.length > 0 && path.length <= 512 && !path.startsWith('/') && !path.includes('\\') && !/[\u0000-\u001f\u007f]/.test(path) && !path.split('/').some(p => !p || p === '.' || p === '..'))
}
export async function backupRead(admin: any, ownerId: string, body: any, projectRef: string) {
  const action=body.action
  const fail=(code: string,status=400): never => { throw Object.assign(new Error(code),{code,status}) }
  if(action==='backup-info') return {protocol:'ydg-bounded-backup-v1',formatVersion:'ydg-business-backup-v1',schemaVersion:'202609070001',projectRef,ownerId,tables:BACKUP_TABLES,buckets:BACKUP_BUCKETS,pageSize:200,storagePageSize:100}
  if(action==='backup-table-page') {
    if(!BACKUP_TABLES.includes(body.table)) fail('BACKUP_TABLE_INVALID')
    const offset=body.offset
    if(!Number.isSafeInteger(offset)||offset<0||offset>1000000) fail('BACKUP_CURSOR_INVALID')
    const {data,error,count}=await admin.from(body.table).select('*',{count:'exact'}).order('id',{ascending:true}).range(offset,offset+199)
    if(error||!Array.isArray(data)||!Number.isSafeInteger(count)) fail('BACKUP_TABLE_READ_FAILED',503)
    return {rows:data,count,offset,nextOffset:offset+data.length,done:offset+data.length>=count}
  }
  if(!BACKUP_BUCKETS.includes(body.bucket)) fail('BACKUP_BUCKET_INVALID')
  if(action==='backup-storage-page') {
    const prefix=body.prefix,offset=body.offset
    if(typeof prefix!=='string'||!safePath(prefix,true)||!Number.isSafeInteger(offset)||offset<0||offset>1000000) fail('BACKUP_CURSOR_INVALID')
    const {data,error}=await admin.storage.from(body.bucket).list(prefix,{limit:100,offset,sortBy:{column:'name',order:'asc'}})
    if(error||!Array.isArray(data)) fail('BACKUP_STORAGE_LIST_FAILED',503)
    return {items:data.map((item:any)=>({name:item.name,id:item.id??null,size:Number(item.metadata?.size??0),mimeType:String(item.metadata?.mimetype??'application/octet-stream'),updatedAt:item.updated_at??null})),done:data.length<100}
  }
  if(action==='backup-object') {
    if(typeof body.path!=='string'||!safePath(body.path)) fail('BACKUP_PATH_INVALID')
    const {data,error}=await admin.storage.from(body.bucket).download(body.path)
    if(error||!data) fail('BACKUP_OBJECT_READ_FAILED',503)
    const max=body.bucket==='product-images'?500*1024:5*1024*1024
    if(!['image/jpeg','image/png','image/webp'].includes(data.type.toLowerCase())||data.size>max) fail('BACKUP_OBJECT_TYPE_SIZE_INVALID')
    return data
  }
  fail('BACKUP_ACTION_INVALID')
}
