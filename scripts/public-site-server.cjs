const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {pipeline}=require('node:stream');
const contact=require('./public-contact.cjs');
const root=path.join(__dirname,'public');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if(req.url==='/api/contacto'&&req.method==='POST')return contact(req,res);
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});return res.end();}
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end();}
  if(pathname==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok');}
  if(pathname==='/index.html'||pathname==='/medicina-laboral.html'){res.writeHead(301,{Location:'/'});return res.end();}
  const parts=pathname.split('/');
  if(parts.some(p=>p.startsWith('.')||p.includes('\\'))){res.writeHead(404);return res.end();}
  let file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
  let status=200;
  if(!mime[path.extname(file)]||!fs.existsSync(file)||!fs.statSync(file).isFile()){file=path.join(root,'404.html');status=404;}
  res.writeHead(status,{'Content-Type':mime[path.extname(file)],'Cache-Control':['.html','.css','.js'].includes(path.extname(file))?'no-cache':'public, max-age=3600'});
  if(req.method==='HEAD')return res.end();
  pipeline(fs.createReadStream(file),res,()=>{});
}).listen(Number(process.env.PORT)||4180,'0.0.0.0');
