// Privileged, read-only emergency export through an already authenticated Supabase CLI.
// Never prints business rows, credentials or private object paths. No restore calls.
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const cli=process.env.YDG_SUPABASE_CLI;
const output=process.env.YDG_PRIVATE_BACKUP_DIR;
if(!cli||!output)throw new Error('Set YDG_SUPABASE_CLI and YDG_PRIVATE_BACKUP_DIR to private local paths.');
const tables=['categories','products','profiles','orders','order_items','cart_items','inventory_movements','voucher_settings','app_settings','delivery_proofs'];
const project=(await readFile('supabase/.temp/project-ref','utf8')).trim();
if(project!=='tfvwfpvdqcbgqnijhhpd')throw new Error('Unexpected linked project.');
const data=tables.map(t=>`'${t}',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.${t} t),'[]'::jsonb)`).join(',');
const counts=tables.map(t=>`'${t}',(select count(*) from public.${t})`).join(',');
const sql=`set statement_timeout='20s'; select jsonb_build_object(
 'metadata',jsonb_build_object('application','Yadanar Theingi Ecommerce','formatVersion','ydg-business-backup-v1','schemaVersion','202609070001','projectRef','${project}','createdAt',now(),'createdBy',(select id from public.profiles where role='owner' order by created_at,id limit 1),'tableCounts',jsonb_build_object(${counts}),'storageCounts',jsonb_build_object('product-images',(select count(*) from storage.objects where bucket_id='product-images'),'delivery-proofs',(select count(*) from storage.objects where bucket_id='delivery-proofs')),'excludes',jsonb_build_array('Auth passwords and hashes','secret keys','tokens','signed URLs','Storage object bytes','DDL, RLS, Edge Functions and project configuration'),'consistency','Single read-only SQL statement snapshot; Storage bytes excluded'),
 'data',jsonb_build_object(${data}),
 'storage',jsonb_build_object('manifests',coalesce((select jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name,'size',coalesce((metadata->>'size')::bigint,0),'mimeType',coalesce(metadata->>'mimetype','application/octet-stream'),'updatedAt',updated_at) order by bucket_id,name) from storage.objects where bucket_id in ('product-images','delivery-proofs')),'[]'::jsonb))
 ) as core;`;
const result=spawnSync(cli,['db','query','--linked',sql,'--output','json'],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:60000,windowsHide:true});
if(result.status!==0)throw new Error('Read-only export failed; no backup marked complete. Inspect CLI connectivity without logging private output.');
const start=result.stdout.indexOf('{'),end=result.stdout.lastIndexOf('}');
const fetched=JSON.parse(result.stdout.slice(start,end+1)).rows?.[0]?.core;
// The v1 validator hashes this explicit top-level order (JSONB itself sorts keys).
const core=fetched ? {metadata:fetched.metadata,data:fetched.data,storage:fetched.storage} : null;
if(!core||core.metadata.projectRef!==project)throw new Error('Incomplete export envelope.');
for(const table of tables){
 if(!Array.isArray(core.data[table])||core.data[table].length!==core.metadata.tableCounts[table])throw new Error('Table count mismatch.');
 if(new Set(core.data[table].map(r=>r.id)).size!==core.data[table].length)throw new Error('Duplicate table row.');
}
const manifests=core.storage.manifests;
if(new Set(manifests.map(r=>r.bucket+'/'+r.path)).size!==manifests.length)throw new Error('Duplicate object metadata.');
for(const bucket of ['product-images','delivery-proofs'])if(manifests.filter(r=>r.bucket===bucket).length!==core.metadata.storageCounts[bucket])throw new Error('Manifest count mismatch.');
const checksum=createHash('sha256').update(JSON.stringify(core)).digest('hex');
const backup={...core,integrity:{algorithm:'SHA-256',checksum}};
const bytes=JSON.stringify(backup,null,2);
if(Buffer.byteLength(bytes)>12*1024*1024)throw new Error('Export exceeds current validator size limit; no complete backup claimed.');
const target=resolve(output);await mkdir(target,{recursive:true});
const file=join(target,'ydg-database-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
await writeFile(file,bytes,{flag:'wx',mode:0o600});
const disk=JSON.parse(await readFile(file,'utf8'));
const diskCore={metadata:disk.metadata,data:disk.data,storage:disk.storage};
if(createHash('sha256').update(JSON.stringify(diskCore)).digest('hex')!==disk.integrity.checksum)throw new Error('Downloaded file checksum mismatch.');
console.log(JSON.stringify({databaseFile:file,bytes:Buffer.byteLength(bytes),tableCounts:disk.metadata.tableCounts,storageManifestCounts:disk.metadata.storageCounts,checksumVerified:true,storageBytesIncluded:false,restoreExecuted:false},null,2));
