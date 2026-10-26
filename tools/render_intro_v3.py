import os
import argparse,json,math,subprocess,wave
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageFilter,ImageOps
from render_intro_v2 import FF,PROBE,PLANS,ROOT,timing
HERE=Path(__file__).resolve().parent;OUT=HERE/'v3renders';OUT.mkdir(exist_ok=True)
CAP=Path(os.environ.get('KURUMI_ENCODER_FFMPEG', FF))
V2=HERE/'v2renders';FPS=90;W,H=1280,720
PARAMS={'saturation':5,'brightness':5,'contrast':5,'shadows':10,'sharpen':30,'clarity':70,
 'requestedFilters':{'高清':20,'清晰Ⅱ':25,'高清增强':40},'filterImplementation':'user-approved equivalent: denoise, local contrast and sharpening; not native CapCut presets'}

def run(cmd):subprocess.run(cmd,check=True)
def stream_rgba(path,frames):
 p=subprocess.Popen([FF,'-hide_banner','-v','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','qtrle',str(path)],stdin=subprocess.PIPE)
 for im in frames:p.stdin.write(im.tobytes())
 p.stdin.close()
 if p.wait():raise RuntimeError('RGBA layer encode failed')

def subtitle(prefix):
 en=ImageFont.truetype(r'C:\Windows\Fonts\timesbd.ttf',24)
 cn=ImageFont.truetype(r'C:\Windows\Fonts\msyhbd.ttc',46)
 mask=Image.new('L',(W,H));d=ImageDraw.Draw(mask)
 for text,y,font,spacing in [('ZAPHKIEL',630,en,5),('刻刻帝',663,cn,12)]:
  widths=[d.textlength(c,font=font) for c in text];x=(W-sum(widths)-spacing*(len(text)-1))/2
  for c,width in zip(text,widths):d.text((x,y),c,font=font,fill=255,stroke_width=1);x+=width+spacing
 band=Image.new('RGBA',(W,H));bd=ImageDraw.Draw(band)
 for y in range(600,H):bd.line((0,y,W,y),fill=(5,5,12,min(255,int((y-600)*10))))
 x=np.arange(W,dtype=np.float32)
 hit=PLANS[prefix]['hit'];cue={'0c5bbc22':2.1,'142de3c3':1.,'5f85f09c':.15,'649e948d':.65}[prefix]
 source=V2/f'intro-{prefix}-3840x2160.mp4'
 decoder=subprocess.Popen([FF,'-hide_banner','-v','error','-i',str(source),'-t','2.2','-vf','scale=1280:720,fps=90','-pix_fmt','rgb24','-f','rawvideo','-'],stdout=subprocess.PIPE)
 def frames():
  for n in range(540):
   t=n/FPS;stripe=np.exp(-((x-((t*340)%1800-260))/110)**2)
   brightness=.5+.5*min(1,max(0,(t-cue)/.25));pulse=1+.25*math.exp(-((t-hit)/.2)**2)
   rgb=np.stack([220+35*stripe,160+95*stripe,82+173*stripe],axis=1)*brightness*pulse
   rgb=np.clip(rgb,0,255).astype(np.uint8)
   color=Image.fromarray(np.broadcast_to(rgb[None,:,:],(H,W,3)).copy(),'RGB').convert('RGBA');color.putalpha(mask)
   glow=color.filter(ImageFilter.GaussianBlur(5));glow.putalpha(glow.getchannel('A').point(lambda a:int(a*.42)))
   im=Image.new('RGBA',(W,H))
   if n<198:
    raw=decoder.stdout.read(W*H*3)
    if len(raw)==W*H*3:
     edge=ImageOps.grayscale(Image.frombytes('RGB',(W,H),raw)).filter(ImageFilter.FIND_EDGES)
     shimmer=.2+.8*np.exp(-((x-((t*700)%1600-150))/100)**2)
     alpha=np.asarray(edge,dtype=np.float32)*shimmer[None,:]*(1-t/2.2)*1.8
     light=Image.new('RGBA',(W,H),(210,240,255,0));light.putalpha(Image.fromarray(np.clip(alpha,0,210).astype(np.uint8)))
     im=Image.alpha_composite(im,light.filter(ImageFilter.GaussianBlur(5)));im=Image.alpha_composite(im,light)
   im=Image.alpha_composite(im,band);im=Image.alpha_composite(im,glow);im=Image.alpha_composite(im,color);yield im
  decoder.stdout.close();decoder.wait()
 target=OUT/f'{prefix}-subtitles.mov';stream_rgba(target,frames());return target

def audio(prefix):
 src=next(ROOT.glob(prefix+'*.mp4'));plan=PLANS[prefix];filters=[];labels=[]
 for i,(a,b,c,d) in enumerate(zip(plan['src'][:-1],plan['src'][1:],plan['dst'][:-1],plan['dst'][1:])):
  rate=(b-a)/(d-c);tempo=[]
  while rate<.5:tempo.append('atempo=0.5');rate/=.5
  while rate>2:tempo.append('atempo=2');rate/=2
  tempo.append(f'atempo={rate:.8f}')
  filters.append(f'[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS,'+','.join(tempo)+f'[a{i}]');labels.append(f'[a{i}]')
 filters.append(''.join(labels)+f'concat=n={len(labels)}:v=0:a=1,apad,atrim=duration=8,volume=0.55[voice]')
 filters.append('[voice][1:a]amix=inputs=2:duration=longest:dropout_transition=0,volume=2,alimiter=limit=0.92[a]')
 target=OUT/f'{prefix}-audio.wav'
 run([FF,'-hide_banner','-v','error','-y','-i',str(src),'-i',str(V2/f'{prefix}-duang.wav'),'-filter_complex',';'.join(filters),'-map','[a]','-t','8',str(target)])
 return target

def water(prefix,base):
 still=OUT/f'{prefix}-still.png';run([FF,'-hide_banner','-v','error','-y','-ss','5.98','-i',str(base),'-frames:v','1',str(still)])
 im=Image.open(still).convert('RGBA');cx,cy=W/2,H/2
 def displacement(x,y,t):
  dx=x-cx;dy=y-cy;r=math.hypot(dx,dy);u=max(0,t-.15)
  if t<.15:return x,y
  wave=0
  for lag,amp in [(0,8),(90,4),(170,2)]:
   delta=r-(430*u-lag);wave+=amp*math.sin(delta*.075)*math.exp(-(delta/62)**2)*math.exp(-u*.5)
  return max(0,min(W-1,x+dx/max(r,1)*wave)),max(0,min(H-1,y+dy/max(r,1)*wave))
 def frames():
  step=32
  for n in range(180):
   t=n/FPS;mesh=[]
   for y in range(0,H,step):
    for x in range(0,W,step):
     x1=min(W,x+step);y1=min(H,y+step)
     pts=[displacement(px,py,t) for px,py in [(x,y),(x,y1),(x1,y1),(x1,y)]]
     mesh.append(((x,y,x1,y1),tuple(v for p in pts for v in p)))
   warped=im.transform((W,H),Image.Transform.MESH,mesh,Image.Resampling.BICUBIC)
   if .1<t<.2:
    drop=Image.new('RGBA',(W,H));dd=ImageDraw.Draw(drop);yy=cy-max(0,.16-t)*180
    dd.ellipse((cx-3,yy-5,cx+3,yy+5),fill=(210,240,255,180));warped=Image.alpha_composite(warped,drop)
   if t>=1:
    u=min(1,(t-1)/(1-1/FPS));ease=u*u*(3-2*u);scale=math.exp(-3.8*ease)
    w=max(2,round(W*scale));h=max(2,round(H*scale))
    small=warped.resize((w,h),Image.Resampling.LANCZOS)
    canvas=Image.new('RGBA',(W,H),(2,3,10,255));canvas.alpha_composite(small,((W-w)//2,(H-h)//2));warped=canvas
   if t>=.18:
    u=min(1,(t-.18)/(2-.18-1/FPS));smooth=u*u*(3-2*u)
    # Requested CapCut strength70 mapped to an equivalent18px blur at720p.
    warped=warped.filter(ImageFilter.GaussianBlur(.35+(18-.35)*smooth))
   yield warped
 target=OUT/f'{prefix}-water.mov';stream_rgba(target,frames())
 # The bundled GPU tool has an incomplete qtrle decoder. Hand it only 4:2:0 H.264.
 compatible=OUT/f'{prefix}-water420.mp4'
 run([FF,'-v','error','-y','-i',str(target),'-an','-pix_fmt','yuv420p','-c:v','libx264','-preset','veryfast','-crf','15',str(compatible)])
 return compatible

def render(prefix,equivalent=False,master=False,reuse=False):
 hit=PLANS[prefix]['hit']
 source=V2/f'intro-{prefix}-3840x2160.mp4';base=OUT/f'{prefix}-enhanced6.mp4'
 grade='eq=saturation=1.05:brightness=0.02:contrast=1.05:gamma=1.035,unsharp=5:5:0.60:5:5:0,unsharp=13:13:0.32:13:13:0'
 decay=f'gte(t,{hit})*exp(-max(t-{hit},0)*4.5)'
 graph=(f'[0:v]trim=duration=6,scale=1280:720:flags=lanczos,{grade},'
  'minterpolate=fps=90:mi_mode=mci:mc_mode=obmc:me_mode=bidir:vsbmc=1,'
  f"scale=1408:792,rotate='0.012*{decay}*sin(42*t)':c=black,crop=1280:720:"
  f"x='64+{decay}*(22*sin(75*floor(t*22.5)/22.5)+9*sin(111*floor(t*22.5)/22.5))':"
  f"y='36+{decay}*(15*sin(63*floor(t*22.5)/22.5)+7*sin(93*floor(t*22.5)/22.5))'[video];"
  '[video][1:v]overlay=0:0:format=auto,setsar=1,format=yuv420p[v]')
 if not reuse:
  sub=subtitle(prefix)
  print(prefix,'enhance, strong impact, shimmer captions, optical-flow 90fps',flush=True)
  run([FF,'-hide_banner','-v','error','-y','-i',str(source),'-i',str(sub),'-filter_complex',graph,'-map','[v]','-an','-t','6','-r','90','-c:v','libx264','-preset','veryfast','-crf','17',str(base)])
 meta=json.loads(subprocess.check_output([PROBE,'-v','error','-show_entries','stream=nb_frames','-of','json',str(base)]));count=int(meta['streams'][0]['nb_frames'])
 if count<540:
  fixed=OUT/f'{prefix}-fixed6.mp4'
  run([FF,'-hide_banner','-v','error','-y','-i',str(base),'-vf',f'loop=loop={540-count}:size=1:start={count-1},setpts=N/(90*TB)','-frames:v','540','-c:v','libx264','-preset','veryfast','-crf','16',str(fixed)]);fixed.replace(base)
 if equivalent:
  filtered=OUT/f'{prefix}-equivalent6.mp4'
  if not filtered.exists() or filtered.stat().st_mtime<base.stat().st_mtime:
   run([FF,'-hide_banner','-v','error','-y','-i',str(base),'-vf',
    'hqdn3d=0.4:0.4:0.8:0.8,unsharp=7:7:0.10:7:7:0,unsharp=13:13:0.10:13:13:0,eq=contrast=1.01,unsharp=5:5:0.16:5:5:0',
    '-an','-frames:v','540','-c:v','libx264','-preset','veryfast','-crf','16',str(filtered)])
  base=filtered
 from intro_effect_v3 import add_entrance
 base=add_entrance(prefix,base,(FF,OUT,W,H,FPS,PLANS,stream_rgba,run))
 tail=water(prefix,base)
 sound=OUT/f'{prefix}-audio.wav'
 if not sound.exists():
  if not any(ROOT.glob(prefix+'*.mp4')):
   print(prefix,'visual render saved; original source path unavailable, waiting to mix audio',flush=True)
   return
  sound=audio(prefix)
 for width,height,folder,bitrate,rate,codec in [(3840,2160,'runtime','18M',60,'h264_nvenc')]+([(7680,4320,'masters','42M',90,'hevc_nvenc')] if master else []):
  dest=OUT/folder;dest.mkdir(exist_ok=True);target=dest/(f'intro-{prefix}-{width}x{height}.mp4' if folder=='runtime' else f'intro-{prefix}-{width}x{height}-90fps.mp4')
  tag=['-tag:v','hvc1'] if codec=='hevc_nvenc' else []
  run([str(CAP),'-hide_banner','-v','error','-y','-i',str(base),'-i',str(tail),'-i',str(sound),
   '-filter_complex',f'[0:v][1:v]concat=n=2:v=1:a=0,settb=1/90,setpts=N,tpad=stop_mode=clone:stop_duration=0.1,fps={rate},scale={width}:{height}:flags=lanczos,setsar=1[v]',
   '-map','[v]','-map','2:a','-t','8','-frames:v',str(rate*8),'-r',str(rate),'-c:v',codec,'-preset','p5','-bf','0','-g',str(rate),'-b:v',bitrate,*tag,'-c:a','aac','-b:a','192k','-movflags','+faststart',str(target)])
  print('Ready',target.name,target.stat().st_size,flush=True)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--clip');ap.add_argument('--equivalent',action='store_true');ap.add_argument('--master',action='store_true');ap.add_argument('--reuse-base',action='store_true');args=ap.parse_args()
 for prefix in PLANS:
  if args.clip and prefix!=args.clip:continue
  render(prefix,args.equivalent,args.master,args.reuse_base and (OUT/f'{prefix}-enhanced6.mp4').exists())
