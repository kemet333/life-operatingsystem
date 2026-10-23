// The desktop app for macOS and Windows: one window over the same local server the Mac app runs (local-workspace), with
// the same protocol. It starts the bundled Node with server.mjs, reads «READY {origin, bootstrapToken}» from its stdout,
// opens the page with the one-time X-Life-Launch header (the server answers with a private session cookie) and keeps
// stdin open: closing it stops the server. Exit code 75 means «start me again» (a new configuracion.json).
import {app,BrowserWindow,dialog,ipcMain,Menu,session,shell} from 'electron';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const APP_ID='com.lifeoperatingsystem.app';
const RESTART=75;
const WIN=process.platform==='win32',MAC=process.platform==='darwin';

// Same data folder as the engine's plataforma.app_data(): <appData>/<APP_ID>/Workspace.
const DATA=process.env.LIFE_OS_DATA_DIR||path.join(app.getPath('appData'),APP_ID,'Workspace');
const RESOURCES=app.isPackaged?process.resourcesPath:path.join(HERE,'recursos');
const NODE=path.join(RESOURCES,'runtime',WIN?'node.exe':'node');
const SERVER=path.join(RESOURCES,'workspace','server.mjs');

let win=null,child=null,origin='',quitting=false;
app.setName(JSON.parse(fs.readFileSync(path.join(HERE,'package.json'),'utf8')).productName);

if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});

function startServer(){
 return new Promise((resolve,reject)=>{
  fs.mkdirSync(DATA,{recursive:true,mode:0o700});
  const env={...process.env,LIFE_OS_DATA_DIR:DATA};delete env.ELECTRON_RUN_AS_NODE;
  const p=spawn(NODE,[SERVER],{cwd:path.dirname(SERVER),env,stdio:['pipe','pipe','ignore'],windowsHide:true});
  child=p;let buffer='',ready=false;
  const timer=setTimeout(()=>{if(!ready){p.kill();reject(Error('El espacio local no ha terminado de arrancar.'));}},20000);
  p.stdout.on('data',piece=>{
   if(ready)return;buffer+=piece.toString();
   const m=buffer.match(/^READY (.+)$/m);if(!m)return;
   try{const info=JSON.parse(m[1]);ready=true;clearTimeout(timer);origin=info.origin;resolve(info);}catch{reject(Error('Respuesta de arranque no válida.'));}
  });
  p.on('error',e=>{clearTimeout(timer);reject(e);});
  p.on('exit',code=>{
   clearTimeout(timer);if(child===p)child=null;
   if(quitting)return;
   if(!ready)return reject(Error('El espacio local se ha detenido al arrancar.'));
   if(code===RESTART)return open().catch(fail);
   fail(Error('El espacio local se ha detenido.'));
  });
 });
}

async function open(){
 const {origin:o,bootstrapToken}=await startServer();
 await win.loadURL(o+'/?native=1&view=now',{extraHeaders:`X-Life-Launch: ${bootstrapToken}\n`});
}

function fail(e){
 if(!win||quitting)return;
 const msg=String(e?.message||e).replace(/[<>&]/g,'');
 win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><meta charset=utf-8><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0b0e;color:#f2f3f5;font:14px -apple-system,Segoe UI,sans-serif"><div style="text-align:center"><p>${msg}</p><p style="color:#8e98a6">Cierra y vuelve a abrir la app.</p></div>`));
}

const isLocal=url=>{try{return !!origin&&new URL(url).origin===origin;}catch{return false;}};

function createWindow(){
 win=new BrowserWindow({
  width:1280,height:820,minWidth:420,minHeight:560,show:false,backgroundColor:'#0b0b0e',
  titleBarStyle:MAC?'hiddenInset':'default',autoHideMenuBar:WIN,
  webPreferences:{preload:path.join(HERE,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,spellcheck:false},
 });
 win.once('ready-to-show',()=>win.show());
 // Only the local page lives in the window; anything else opens in the default browser.
 win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return {action:'deny'};});
 win.webContents.on('will-navigate',(e,url)=>{if(!isLocal(url)&&!url.startsWith('data:')){e.preventDefault();if(/^https?:/.test(url))shell.openExternal(url);}});
 win.on('closed',()=>{win=null;});
}

ipcMain.handle('elegir-carpeta',async(e,titulo)=>{
 if(!win||!isLocal(e.senderFrame.url))return '';
 const r=await dialog.showOpenDialog(win,{title:typeof titulo==='string'?titulo.slice(0,80):'Elige una carpeta',properties:['openDirectory','createDirectory']});
 return r.canceled?'':r.filePaths[0]||'';
});

app.whenReady().then(async()=>{
 // The microphone (push-to-talk) only for the local page.
 session.defaultSession.setPermissionRequestHandler((wc,perm,cb,details)=>cb(perm==='media'&&isLocal(details.requestingUrl||wc.getURL())));
 session.defaultSession.setPermissionCheckHandler((wc,perm,requestingOrigin)=>perm==='media'&&requestingOrigin===origin);
 if(!MAC)Menu.setApplicationMenu(null);
 createWindow();
 try{await open();}catch(e){fail(e);}
});

function stopServer(){
 quitting=true;
 const p=child;if(!p)return;
 try{p.stdin.end();}catch{}
 setTimeout(()=>{try{p.kill();}catch{}},5000).unref();
}
app.on('before-quit',stopServer);
app.on('window-all-closed',()=>{app.quit();});
