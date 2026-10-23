// The system's secret store, for the few keys the app keeps (Telegram bot token, ElevenLabs key): the macOS Keychain, the
// Windows Credential Manager or the Linux Secret Service. A value never goes on a command line: it travels on stdin.
// equipo/plataforma.py reads the same entries (service name = target name), so the team engine finds them too.
import {execFile} from 'node:child_process';
import {userInfo} from 'node:os';

const SERVICE=/^[a-z][a-z0-9-]{2,40}$/;

function run(cmd:string,args:string[],input?:string,timeout=8000){
 return new Promise<{code:number,out:string}>(resolve=>{
  const p=execFile(cmd,args,{timeout,windowsHide:true,maxBuffer:1<<20},(e:any,stdout)=>resolve({code:e?(typeof e.code==='number'?e.code:1):0,out:String(stdout||'')}));
  p.stdin?.end(input??"");
 });
}

// Windows: CredRead/CredWrite through PowerShell (no extra modules). Generic credentials, UTF-16 blob as cmdkey writes them.
const PS_CRED=`Add-Type -Namespace W -Name C -MemberDefinition @'
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredReadW(string t, int y, int f, out IntPtr c);
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWriteW(ref CRED c, int f);
[DllImport("advapi32.dll")] public static extern void CredFree(IntPtr c);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CRED { public int Flags; public int Type; public string TargetName; public string Comment;
 public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes;
 public string TargetAlias; public string UserName; }
'@
`;
const psRead=(service:string)=>PS_CRED+`$p=[IntPtr]::Zero; if([W.C]::CredReadW('${service}',1,0,[ref]$p)){ $c=[Runtime.InteropServices.Marshal]::PtrToStructure($p,[type][W.C+CRED]);
 [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob,$c.CredentialBlobSize/2)); [W.C]::CredFree($p) } else { exit 1 }`;
const psWrite=(service:string)=>PS_CRED+`$v=[Console]::In.ReadToEnd().Trim(); $b=[Runtime.InteropServices.Marshal]::StringToCoTaskMemUni($v);
 $c=New-Object W.C+CRED; $c.Type=1; $c.TargetName='${service}'; $c.UserName='alfred'; $c.Persist=2; $c.CredentialBlob=$b; $c.CredentialBlobSize=$v.Length*2;
 $ok=[W.C]::CredWriteW([ref]$c,0); [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($b); if(-not $ok){ exit 1 }`;

/** The stored value, or null. */
export async function leer(service:string):Promise<string|null>{
 if(!SERVICE.test(service))return null;
 let r;
 if(process.platform==='darwin')r=await run('/usr/bin/security',['find-generic-password','-s',service,'-w']);
 else if(process.platform==='win32')r=await run('powershell',['-NoProfile','-NonInteractive','-Command',psRead(service)],undefined,15000);
 else r=await run('secret-tool',['lookup','service',service]);
 const v=r.out.trim();
 return r.code===0&&v?v:null;
}

/** Saves (or replaces) a value. True when the store accepted it. */
export async function guardar(service:string,value:string):Promise<boolean>{
 if(!SERVICE.test(service)||!value||/[\r\n]/.test(value))return false;
 let r;
 if(process.platform==='darwin'){
  // `security -i` reads its command from stdin, so the value is not visible in the process list.
  const quoted='"'+value.replace(/(["\\])/g,'\\$1')+'"';
  r=await run('/usr/bin/security',['-i'],`add-generic-password -U -a ${userInfo().username} -s ${service} -w ${quoted}\n`);
 }
 else if(process.platform==='win32')r=await run('powershell',['-NoProfile','-NonInteractive','-Command',psWrite(service)],value,15000);
 else r=await run('secret-tool',['store','--label='+service,'service',service],value);
 return r.code===0&&(await leer(service))===value;
}
