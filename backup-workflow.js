(function (root) {
  'use strict';
  var TABLES = ['categories','products','profiles','orders','order_items','cart_items','inventory_movements','voucher_settings','app_settings','delivery_proofs'];
  var BUCKETS = ['product-images','delivery-proofs'];
  var FORMAT = 'ydg-business-backup-v1', SCHEMA = '202609070001';
  var MAX_DB = 12 * 1024 * 1024;
  function fail(message) { throw new Error(message); }
  function safePath(path, empty) { return (empty && path === '') || (typeof path === 'string' && path.length > 0 && path.length <= 512 && !path.startsWith('/') && !path.includes('\\') && !/[\u0000-\u001f\u007f]/.test(path) && !path.split('/').some(function (p) { return !p || p === '.' || p === '..'; })); }
  async function hash(value) { var bytes = value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? value : new TextEncoder().encode(JSON.stringify(value)); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(function (b) { return b.toString(16).padStart(2,'0'); }).join(''); }
  function order(a,b) { return a < b ? -1 : a > b ? 1 : 0; }
  function manifestSort(a,b) { return order(a.bucket+'/'+a.path,b.bucket+'/'+b.path); }
  function validateEntry(entry) {
    var max=entry.bucket==='product-images'?500*1024:5*1024*1024;
    if (!BUCKETS.includes(entry.bucket) || !safePath(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > max || !['image/jpeg','image/png','image/webp'].includes(entry.mimeType)) fail('Storage contains an unsupported path, type or size. Backup is incomplete.');
  }
  function validImage(bytes,mime,path) {
    var b=new Uint8Array(bytes),p=path.toLowerCase();
    if(mime==='image/png')return p.endsWith('.png')&&[137,80,78,71,13,10,26,10].every(function(x,i){return b[i]===x;});
    if(mime==='image/jpeg')return /\.(jpe?g|jfif)$/.test(p)&&b[0]===255&&b[1]===216&&b[2]===255;
    return mime==='image/webp'&&p.endsWith('.webp')&&String.fromCharCode.apply(null,b.slice(0,4))==='RIFF'&&String.fromCharCode.apply(null,b.slice(8,12))==='WEBP';
  }
  async function validateDatabase(backup) {
    if(backup?.metadata?.formatVersion!==FORMAT||backup.metadata.schemaVersion!==SCHEMA||!Array.isArray(backup.storage?.manifests))fail('Backup format/schema is incompatible.');
    for(var table of TABLES){var rows=backup.data?.[table];if(!Array.isArray(rows)||rows.length!==backup.metadata.tableCounts?.[table]||rows.some(function(r){return r.id===null||r.id===undefined;})||new Set(rows.map(function(r){return r.id;})).size!==rows.length)fail('Backup table count/identity mismatch.');}
    var manifest=backup.storage.manifests;
    if(new Set(manifest.map(function(e){return (e.bucket+'/'+e.path).toLowerCase();})).size!==manifest.length)fail('Duplicate manifest path.');
    for(var bucket of BUCKETS)if(manifest.filter(function(e){return e.bucket===bucket;}).length!==backup.metadata.storageCounts?.[bucket])fail('Storage count mismatch.');
    manifest.forEach(validateEntry);
    var core={metadata:backup.metadata,data:backup.data,storage:backup.storage};
    if(backup.integrity?.algorithm!=='SHA-256'||await hash(core)!==backup.integrity.checksum)fail('Database checksum mismatch.');
    return {valid:true,tableCounts:backup.metadata.tableCounts};
  }
  function create(read, options) {
    options=options||{};
    var sleep=options.sleep||function(ms){return new Promise(function(r){setTimeout(r,ms);});};
    var job=null;
    async function call(action, args, progress) {
      for(var attempt=0;attempt<3;attempt++){
        try{return await read(action,args);}
        catch(error){if(error.status===400||error.status===401||error.status===403||error.status===409||attempt===2)throw error;
          progress('Retrying a read-only step ('+(attempt+1)+'/2). Backup is not complete.');await sleep(500*(attempt+1));}
      }
    }
    async function info(progress){var result=await call('backup-info',{},progress);if(result.protocol!=='ydg-bounded-backup-v1'||result.schemaVersion!==SCHEMA||JSON.stringify(result.tables)!==JSON.stringify(TABLES)||JSON.stringify(result.buckets)!==JSON.stringify(BUCKETS))fail('Bounded backup backend is not deployed. No backup completed.');return result;}
    async function tables(progress) {
      var data={},bytes=0;
      for(var table of TABLES){var rows=[],ids=new Set(),offset=0,total=null;
        for(;;){var page=await call('backup-table-page',{table:table,offset:offset},progress);
          if(!Array.isArray(page.rows)||page.rows.length>200||page.offset!==offset||!Number.isSafeInteger(page.count)||page.count<0||page.count>100000||page.nextOffset!==offset+page.rows.length)fail('Invalid/truncated database page.');
          if(total!==null&&total!==page.count)fail('Database changed during backup. Start a fresh backup.');total=page.count;
          for(var row of page.rows){if(row.id===null||row.id===undefined||ids.has(String(row.id)))fail('Duplicate/missing database row. Start a fresh backup.');ids.add(String(row.id));rows.push(row);bytes+=new TextEncoder().encode(JSON.stringify(row)).length;}
          if(bytes>MAX_DB)fail('Database exceeds the current 12 MB restore format. No complete backup produced.');
          offset=page.nextOffset;progress('Reading '+table+': '+offset+'/'+total+' records.');
          if(page.done){if(offset!==total)fail('Database count mismatch.');break;}
          if(!page.rows.length||offset>=total)fail('Database pagination did not advance.');
        }data[table]=rows;
      }return data;
    }
    async function manifest(progress) {
      var entries=[],paths=new Set(),folders=new Set();
      for(var bucket of BUCKETS){var queue=[''];for(var at=0;at<queue.length;at++){
        if(queue.length>20000)fail('Storage folder safety limit reached; backup is incomplete.');
        var prefix=queue[at],folderKey=bucket+'/'+prefix;
        if(folders.has(folderKey))fail('Duplicate folder returned by Storage.');folders.add(folderKey);
        for(var offset=0;;){var page=await call('backup-storage-page',{bucket:bucket,prefix:prefix,offset:offset},progress);
          if(!Array.isArray(page.items)||page.items.length>100||page.done!==(page.items.length<100))fail('Invalid Storage pagination response.');
          for(var item of page.items){if(typeof item.name!=='string'||item.name.includes('/'))fail('Unsafe Storage entry.');var path=prefix?prefix+'/'+item.name:item.name;if(!safePath(path))fail('Unsafe Storage path.');
            if(item.id){var entry={bucket:bucket,path:path,size:item.size,mimeType:item.mimeType.toLowerCase(),updatedAt:item.updatedAt};validateEntry(entry);var key=(bucket+'/'+path).toLowerCase();if(paths.has(key))fail('Duplicate/conflicting Storage path.');paths.add(key);entries.push(entry);}
            else queue.push(path);
          }
          if(entries.length>20000)fail('Storage file safety limit reached; backup is incomplete.');
          progress('Listing Storage: '+entries.length+' files found; scanning all folders/pages.');
          if(page.done)break;offset+=page.items.length;
        }
      }}return entries.sort(manifestSort);
    }
    function counts(list){return Object.fromEntries(BUCKETS.map(function(b){return [b,list.filter(function(e){return e.bucket===b;}).length];}));}
    async function database(progress){progress=progress||function(){};var metadata=await info(progress);var data=await tables(progress);
      progress('Verifying a second database read. No download marked complete yet.');
      if(await hash(data)!==await hash(await tables(progress)))fail('Source data changed between verification passes. Retry during a quiet period.');
      var core={metadata:{application:'Yadanar Theingi Ecommerce',formatVersion:FORMAT,projectRef:metadata.projectRef,schemaVersion:SCHEMA,createdAt:new Date().toISOString(),createdBy:metadata.ownerId,tableCounts:Object.fromEntries(TABLES.map(function(t){return [t,data[t].length];})),storageCounts:counts([]),excludes:['Auth passwords and hashes','secret keys','tokens','signed URLs','Storage object metadata and bytes','DDL and project configuration'],consistency:'Two matching database read passes, not an MVCC snapshot. Storage has its own separately verified archive set.'},data:data,storage:{manifests:[]}};
      var backup=Object.assign({},core,{integrity:{algorithm:'SHA-256',checksum:await hash(core)}});
      if(new TextEncoder().encode(JSON.stringify(backup,null,2)).length>MAX_DB)fail('Backup exceeds restore size limit.');
      await validateDatabase(backup);return backup;
    }
    function partition(list){var parts=[],part=[],bytes=0;for(var entry of list){if(part.length&&(part.length>=4||bytes+entry.size>8*1024*1024)){parts.push(part);part=[];bytes=0;}part.push(entry);bytes+=entry.size;}if(part.length)parts.push(part);return parts;}
    async function storage(progress,savePart){progress=progress||function(){};var metadata=await info(progress);
      if(job&&job.ownerId!==metadata.ownerId)job=null;
      if(!job){progress('Initial Storage scan: reading every approved folder/page once.');var listed=await manifest(progress);job={ownerId:metadata.ownerId,manifest:listed,parts:partition(listed),completed:[],current:new Map(),startedAt:new Date().toISOString()};}
      var currentJob=job;
      if(!root.JSZip)fail('Archive library unavailable. Refresh and retry.');
      for(var partIndex=currentJob.completed.length;partIndex<currentJob.parts.length;partIndex++){
        var zip=new root.JSZip(),objects=[];
        for(var entry of currentJob.parts[partIndex]){
          var key=entry.bucket+'/'+entry.path;progress('Part '+(partIndex+1)+'/'+currentJob.parts.length+': reading file '+(objects.length+1)+'/'+currentJob.parts[partIndex].length+'. Retry resumes this tab.');
          var bytes=currentJob.current.get(key);
          if(!bytes){var blob=await call('backup-object',{bucket:entry.bucket,path:entry.path},progress);if(!(blob instanceof Blob))fail('Binary download was not received safely.');bytes=await blob.arrayBuffer();if(bytes.byteLength!==entry.size||!validImage(bytes,entry.mimeType,entry.path))fail('Storage object changed or image validation failed. Restart backup.');currentJob.current.set(key,bytes);}
          objects.push(Object.assign({},entry,{checksum:await hash(bytes)}));zip.file(key,new Uint8Array(bytes));await sleep(0);
        }
        var core={application:'Yadanar Theingi Ecommerce',formatVersion:'ydg-storage-archive-v1',schemaVersion:SCHEMA,createdAt:currentJob.startedAt,createdBy:currentJob.ownerId,partNumber:partIndex+1,partCount:currentJob.parts.length,objects:objects};
        var sum=await hash(core);zip.file('manifest.json',JSON.stringify(Object.assign({},core,{integrity:{algorithm:'SHA-256',checksum:sum}}),null,2));
        var archive=await zip.generateAsync({type:'uint8array',compression:'STORE'});
        // Re-open generated bytes and CRC before exposing a download.
        var verified=await root.JSZip.loadAsync(archive,{checkCRC32:true});
        for(var object of objects)if(await hash(await verified.file(object.bucket+'/'+object.path).async('uint8array'))!==object.checksum)fail('Archive verification failed.');
        var filename='ydg-private-storage-'+currentJob.startedAt.replace(/[:.]/g,'-')+'-part-'+(partIndex+1)+'-of-'+currentJob.parts.length+'.zip';
        await savePart(new Blob([archive],{type:'application/zip'}),filename);
        currentJob.completed.push({partNumber:partIndex+1,filename:filename,files:objects.length,bytes:archive.length,checksum:await hash(archive)});currentJob.current.clear();
      }
      progress('Final verification scan: all parts are saved; checking that Storage did not change.');
      if(await hash(currentJob.manifest)!==await hash(await manifest(progress))){job=null;fail('Storage changed during backup. Existing downloaded parts are INCOMPLETE; start a fresh set.');}
      var index={formatVersion:'ydg-storage-set-v1',schemaVersion:SCHEMA,createdAt:currentJob.startedAt,complete:true,totalFiles:currentJob.manifest.length,bucketCounts:counts(currentJob.manifest),partCount:currentJob.parts.length,parts:currentJob.completed,manifestChecksum:await hash(currentJob.manifest),consistency:'Metadata verified before/after; not atomic with database backup. Files must be saved by the browser; retain this completion index and every part.'};
      var result=Object.assign({},index,{integrity:{algorithm:'SHA-256',checksum:await hash(index)}});job=null;return result;
    }
    return {database:database,storage:storage,reset:function(){job=null;},hasResume:function(){return !!job;}};
  }
  root.YDGBackupWorkflow={create:create,hash:hash,validateDatabase:validateDatabase};
})(typeof window!=='undefined'?window:globalThis);
