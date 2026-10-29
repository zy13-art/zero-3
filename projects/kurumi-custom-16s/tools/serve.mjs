import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,stat,rename,rm} from 'node:fs/promises';
import {dirname,resolve,sep,extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.argv.find(arg=>arg.startsWith('--port='))?.slice(7)||8892);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local preview port');
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.mp4':'video/mp4','.m4a':'audio/mp4','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
let saving=false;
async function mux(video,dest){
 const ff=process.env.FFMPEG||'ffmpeg',audio=join(root,'source/assets/startup-audio.m4a');
 await new Promise((ok,no)=>{
  const child=spawn(ff,['-v','error','-y','-i',video,'-i',audio,'-map','0:v:0','-map','1:a:0','-c','copy','-t','16','-movflags','+faststart',dest],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let error='';child.stderr.on('data',d=>{error+=d.toString();if(error.length>4000)error=error.slice(-4000)});
  child.on('error',no);child.on('exit',code=>code===0?ok():no(Error(error||'FFmpeg mux failed')));
 });
}
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(req.method==='POST'&&url.pathname==='/save-movie'){
   const profile=url.searchParams.get('profile');if(!['4K60','1080p120'].includes(profile))throw Error('Unknown export profile');
   if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`){res.writeHead(403);res.end('Local preview origin required');return;}
   if(saving){res.writeHead(409);res.end('Another export is being saved');return;}
   saving=true;
   try{
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>150*1024*1024)throw Error('Export exceeds 150 MB');chunks.push(chunk)}
    if(size<12||Buffer.concat(chunks,Math.min(size,12)).toString('ascii',4,8)!=='ftyp')throw Error('Expected an MP4 export');
    const output=join(root,'exports');await mkdir(output,{recursive:true});
    const video=join(output,`kurumi-custom-16s-${profile}.video-only.mp4`),dest=join(output,`kurumi-custom-16s-${profile}.mp4`),pending=dest+'.pending.mp4';
    await writeFile(video,Buffer.concat(chunks));
    try{await mux(video,pending);await rename(pending,dest);}
    catch(error){await rm(pending,{force:true});throw Error(`Video-only file saved in exports/. Configure FFmpeg and retry to add music: ${error.message}`);}
    res.writeHead(200,{'content-type':'text/plain; charset=utf-8'});res.end('Saved video with original audio');
   }finally{saving=false;}
   return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  const relative=decodeURIComponent(url.pathname==='/'?'/preview.html':url.pathname);
  const file=resolve(root,'.'+relative);
  if(!file.startsWith(root+sep)||relative.split('/').some(p=>p.startsWith('.'))){res.writeHead(403);res.end();return;}
  const info=await stat(file);if(!info.isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','content-length':info.size,'cache-control':'no-store'});
  if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
 }catch(error){res.writeHead(500,{'content-type':'text/plain; charset=utf-8'});res.end(error.message);}
}).listen(port,'127.0.0.1',()=>console.log(`Preview: http://127.0.0.1:${port}/`));
