const http=require('http'), fs=require('fs'), path=require('path');
const root=path.resolve(__dirname,'../public');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(data);});}).listen(4174,'127.0.0.1',()=>console.log('Preview http://127.0.0.1:4174/medicina-laboral.html'));
