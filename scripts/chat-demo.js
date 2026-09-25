// Demo aislada: no carga server.js, .env, PostgreSQL ni servicios de Daily.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('../test/chat-fixture');
async function main(){
  const f=fixture();await f.module.init();
  f.turns.a.link_paciente=null;
  f.turns.a.paciente='Paciente ficticio · DEMO LOCAL';
  const token=await f.invite();
  const assets=new Set(['atencion.html','atencion.css','atencion.js','logo.png']);
  const server=http.createServer(async(req,res)=>{
    try{
      res.setHeader('Cache-Control','no-store');
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/'){
        res.setHeader('Content-Type','text/html; charset=utf-8');
        return res.end('<!doctype html><html lang="es"><meta charset="utf-8"><title>Demo local MEDGRUP</title><body style="font:18px Arial;padding:40px"><h1>Chat MEDGRUP · Demo local</h1><p>Datos ficticios en memoria. No hay conexión con pacientes ni llamadas reales.</p><p>Abrí las dos vistas para intercambiar mensajes y archivos:</p><p><a target="_blank" href="/demo-medico">Vista del médico</a></p><p><a target="_blank" href="/atencion.html#token='+token+'">Vista del paciente</a></p><p>Los datos se eliminan al detener esta demo.</p></body></html>');
      }
      if(url.pathname==='/demo-medico'){
        res.setHeader('Content-Type','text/html; charset=utf-8');
        return res.end('<script>localStorage.setItem("medgrup_token","demo-local");location.replace("/atencion.html#turno=a");</script>');
      }
      const asset=url.pathname.slice(1);
      if(req.method==='GET'&&assets.has(asset)){
        const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
        res.setHeader('Content-Type',mime[path.extname(asset)]);return res.end(fs.readFileSync(path.join(__dirname,'../public',asset)));
      }
      for(const route of f.routes.keys()){
        const [method,pattern]=route.split(' ');if(method!==req.method)continue;
        const keys=[];const re=new RegExp('^'+pattern.replace(/:([A-Za-z]+)/g,(_,key)=>{keys.push(key);return '([^/]+)';})+'$');
        const match=url.pathname.match(re);if(!match)continue;
        let raw='',size=0;
        for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024){res.writeHead(413);res.end();return;}raw+=chunk;}
        const result=await f.request(method,pattern,{params:Object.fromEntries(keys.map((key,i)=>[key,decodeURIComponent(match[i+1])])),query:Object.fromEntries(url.searchParams),headers:req.headers,body:raw?JSON.parse(raw):{},usuario:req.headers['x-session-token']==='demo-local'?f.admin:undefined});
        res.writeHead(result.code,{'Content-Type':'application/json; charset=utf-8',...result.headers});
        return res.end(Buffer.isBuffer(result.data)?result.data:JSON.stringify(result.data));
      }
      res.writeHead(404);res.end('No encontrado');
    }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
  });
  server.listen(3499,'127.0.0.1',()=>console.log('Demo aislada: http://127.0.0.1:3499 (Ctrl+C para cerrar)'));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
