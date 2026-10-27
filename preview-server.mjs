// Local fixture only: serves candidate code and reads the unchanged active films.
// Does not launch Codex, open CDP, or write any app/media files.
import {createServer} from 'node:http';
import {createReadStream,existsSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {dirname,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(await readFile(join(root,'config.json'),'utf8'));
const filmsArg=process.argv.find(x=>x.startsWith('--films-dir='))?.slice(12);
const films=filmsArg||(existsSync(join(root,'films'))?join(root,'films'):join(root,'..','..','outputs','CodexKurumiIntro','films'));
const port=Number(process.argv.find(x=>x.startsWith('--port='))?.slice(7)||8891);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid preview port');
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1'),path=decodeURIComponent(url.pathname);
  let file,mime;
  if(path==='/'||path==='/overlay-preview.html'){file=join(root,'overlay-preview.html');mime='text/html; charset=utf-8';}
  else if(path==='/overlay.mjs'){file=join(root,'overlay.mjs');mime='text/javascript; charset=utf-8';}
  else if(path==='/config.json'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({playlist:config.playlist}));return;}
  else if(path.startsWith('/films/')&&config.playlist.includes(path.slice(7))&&basename(path.slice(7))===path.slice(7)){file=join(films,path.slice(7));mime='video/mp4';}
  else{res.writeHead(404);res.end();return;}
  const info=await stat(file);res.writeHead(200,{'content-type':mime,'content-length':info.size,'cache-control':'no-store'});createReadStream(file).pipe(res);
 }catch{res.writeHead(404);res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`Isolated overlay fixture: http://127.0.0.1:${port}/`));
