import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function openDatabase(directory) {
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,'workspace.sqlite');
 const sqlite=new DatabaseSync(file);
 fs.chmodSync(file,0o600);
 sqlite.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY NOT NULL,kind TEXT NOT NULL,project TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'inbox',role TEXT NOT NULL DEFAULT 'alfred',external_id TEXT,result TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS office(id TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS local_admissions(id TEXT PRIMARY KEY NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS local_metadata(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL);`);
 class Statement {
  constructor(sql,args=[]){this.sql=sql;this.args=args;}
  bind(...args){return new Statement(this.sql,args);}
  execute(){const s=sqlite.prepare(this.sql);let rows=[],changes=0,last=0;if(s.columns().length){rows=s.all(...this.args);changes=Number(sqlite.prepare('SELECT changes() n').get().n);}else{const result=s.run(...this.args);changes=Number(result.changes);last=Number(result.lastInsertRowid);}return {results:rows,success:true,meta:{changes,last_row_id:last}};}
  async first(column){const row=sqlite.prepare(this.sql).get(...this.args);return row ? (column?row[column]:row) : null;}
  async all(){return this.execute();}
  async run(){return this.execute();}
 }
 let transactionId=0;
 const DB={prepare(sql){return new Statement(sql);},async batch(statements){const name='batch_'+(++transactionId);sqlite.exec('SAVEPOINT '+name);try{const result=statements.map(s=>s.execute());sqlite.exec('RELEASE '+name);return result;}catch(e){sqlite.exec('ROLLBACK TO '+name);sqlite.exec('RELEASE '+name);throw e;}}};
 async function transaction(action){sqlite.exec('BEGIN IMMEDIATE');try{const result=await action();sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
 function importInitial(file){
  if(!fs.existsSync(file)||sqlite.prepare("SELECT 1 FROM local_metadata WHERE key='cloud-import'").get())return;
  if(sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n||sqlite.prepare('SELECT COUNT(*) n FROM office').get().n)throw Error('La importación inicial necesita una base local vacía.');
  const bytes=fs.readFileSync(file);if(bytes.length>40_000_000)throw Error('La copia inicial es demasiado grande.');
  const data=JSON.parse(bytes);if(data.version!==1||!Array.isArray(data.entries)||!Array.isArray(data.office)||data.entries.length>10000||data.office.length>10000)throw Error('La copia inicial no es válida.');
  sqlite.exec('BEGIN IMMEDIATE');try{
   const insertEntry=sqlite.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?)');
   for(const e of data.entries){if(!['idea','request','conversation'].includes(e.kind)||typeof e.id!=='string'||!Number.isSafeInteger(e.created_at)||!Number.isSafeInteger(e.updated_at))throw Error('Entrada inicial no válida.');insertEntry.run(e.id,e.kind,e.project,e.title,e.body,e.status,e.role,e.external_id??null,e.result??null,e.created_at,e.updated_at);}
   const insertOffice=sqlite.prepare('INSERT INTO office VALUES (?,?,?)');
   for(const e of data.office){if(typeof e.id!=='string'||typeof e.value!=='string'||!Number.isSafeInteger(e.updated_at))throw Error('Memoria inicial no válida.');JSON.parse(e.value);insertOffice.run(e.id,e.value,e.updated_at);}
   sqlite.prepare("INSERT INTO local_metadata VALUES ('cloud-import',?)").run(JSON.stringify({source:data.source,exportedAt:data.exportedAt,sha256:createHash('sha256').update(bytes).digest('hex')}));
   // Imported requests retain their historical state, but are never admitted to local execution.
   sqlite.exec('COMMIT');
  }catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 return {DB,sqlite,importInitial,transaction,close(){sqlite.close();}};
}
