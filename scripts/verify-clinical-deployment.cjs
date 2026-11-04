// Read-only checks. No login, patient data, room creation or provider credentials.
const path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const base='https://medicinalaboral.medgrup.com.ar';
const files=['index.html','llamada.js','chat-medico.js','descargas.js','ausentismo-flow.js','ausentismo-flow.css','claude-demo.css','empresa.html','claude-portal.css','ingreso.html','ingreso.css','ingreso.js','atencion.html','atencion.css','atencion.js'];
const revision=process.argv[2]||'HEAD';
if(!/^[a-zA-Z0-9._/-]+$/.test(revision))throw Error('Revisión inválida');
// Git export attributes may normalize line endings. Compare content separately
// from the byte-level version computed by the running server.
const committed=file=>execFileSync('git',['show',`${revision}:public/${file}`],{cwd:path.join(__dirname,'..')});
async function main(){
  const expected=crypto.createHash('sha256');
  const health=await fetch(base+'/api/health',{signal:AbortSignal.timeout(20000)});
  if(!health.ok || !(await health.json()).ok)throw Error('El portal no respondió salud OK');
  const response=await fetch(base+'/api/version',{signal:AbortSignal.timeout(20000)});
  const deployed=await response.json();
  for(const file of files){
    const r=await fetch(base+'/'+file,{signal:AbortSignal.timeout(20000)});
    const bytes=Buffer.from(await r.arrayBuffer());
    if(!r.ok||bytes.toString('utf8').replace(/\r\n/g,'\n')!==committed(file).toString('utf8').replace(/\r\n/g,'\n'))throw Error('El recurso publicado no coincide: '+file);
    expected.update(bytes);
  }
  const version=expected.digest('hex').slice(0,16);
  if(deployed.version!==version)throw Error('La huella del servidor no coincide con sus recursos publicados');
  console.log(JSON.stringify({ok:true,version,health:'OK',newAssets:'coinciden con el commit '+revision,url:base}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
