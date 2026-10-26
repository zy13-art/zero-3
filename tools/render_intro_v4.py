"""Clean-source edits. No generated clock or inferred complete-clock geometry."""
import argparse,copy,json,math,subprocess,wave
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageFilter
from render_intro_v2 import FF,PROBE,ROOT,PLANS as ORIGINAL_PLANS,timing
import render_intro_v3 as helpers
from intro_effect_v3 import add_entrance
import clock_contour_effect
from clock_contour_effect import make_clock_fx

HERE=Path(__file__).resolve().parent
OUT=HERE/'v4renders';OUT.mkdir(exist_ok=True)
helpers.OUT=OUT
CAP=helpers.CAP
FPS=90;W,H=1280,720
PLANS=copy.deepcopy(ORIGINAL_PLANS)
PLANS['649e948d']['hit']=5.05

def run(args):subprocess.run(args,check=True)
def meta(path):
 return json.loads(subprocess.check_output([PROBE,'-v','error','-select_streams','v:0','-show_entries','stream=width,height,nb_frames,avg_frame_rate,pix_fmt,sample_aspect_ratio,duration','-of','json',str(path)]))['streams'][0]
def cached(path,frames=540):
 if not path.exists() or path.stat().st_size<1000:return False
 try:return int(meta(path)['nb_frames'])==frames
 except Exception:return False

def native_timed(prefix):
 target=OUT/f'{prefix}-native-timed6.mp4'
 if cached(target):return target
 source=next(ROOT.glob(prefix+'*.mp4'))
 print(prefix,'retiming ORIGINAL footage with one optical-flow 90fps pass',flush=True)
 graph=f"setpts='{timing(PLANS[prefix])}',minterpolate=fps=90:mi_mode=mci:mc_mode=obmc:me_mode=bidir:vsbmc=1,scale={W}:{H}:flags=lanczos,setsar=1,format=yuv420p"
 run([FF,'-hide_banner','-v','error','-y','-i',str(source),'-vf',graph,'-an','-t','6','-r','90','-c:v','libx264','-preset','veryfast','-crf','15',str(target)])
 count=int(meta(target)['nb_frames'])
 if count<540:
  assert count>=515,(prefix,count)
  fixed=OUT/f'{prefix}-native-fixed6.mp4'
  run([FF,'-v','error','-y','-i',str(target),'-vf',f'loop=loop={540-count}:size=1:start={count-1},setpts=N/(90*TB),setsar=1','-frames:v','540','-pix_fmt','yuv420p','-c:v','libx264','-preset','veryfast','-crf','15',str(fixed)])
  fixed.replace(target)
 assert cached(target)
 return target

def captions(prefix):
 target=OUT/f'{prefix}-captions-hit{PLANS[prefix]["hit"]:.2f}.mov'
 if target.exists():
  try:
   if int(meta(target)['nb_frames'])==540:return target
  except Exception:pass
 en=ImageFont.truetype(r'C:\Windows\Fonts\timesbd.ttf',24)
 cn=ImageFont.truetype(r'C:\Windows\Fonts\msyhbd.ttc',46)
 mask=Image.new('L',(W,H));draw=ImageDraw.Draw(mask)
 for text,y,font,spacing in [('ZAPHKIEL',630,en,5),('刻刻帝',660,cn,12)]:
  widths=[draw.textlength(c,font=font) for c in text];x=(W-sum(widths)-spacing*(len(text)-1))/2
  for ch,cw in zip(text,widths):draw.text((x,y),ch,font=font,fill=255,stroke_width=1);x+=cw+spacing
 band=Image.new('RGBA',(W,H));bd=ImageDraw.Draw(band)
 for y in range(600,H):bd.line((0,y,W,y),fill=(5,5,12,min(255,int((y-600)*10))))
 xs=np.arange(W,dtype=np.float32);hit=PLANS[prefix]['hit'];cue={'0c5bbc22':2.1,'142de3c3':1.,'5f85f09c':.15,'649e948d':.65}[prefix]
 def frames():
  for n in range(540):
   t=n/FPS;brightness=.5+.5*min(1,max(0,(t-cue)/.25));pulse=1+.25*math.exp(-((t-hit)/.2)**2)
   stripe=np.exp(-((xs-((t*340)%1800-260))/110)**2)
   rgb=np.clip(np.stack([220+35*stripe,160+95*stripe,82+173*stripe],axis=1)*brightness*pulse,0,255).astype(np.uint8)
   ink=Image.fromarray(np.broadcast_to(rgb[None,:,:],(H,W,3)).copy(),'RGB').convert('RGBA');ink.putalpha(mask)
   glow=ink.filter(ImageFilter.GaussianBlur(5));glow.putalpha(glow.getchannel('A').point(lambda a:int(a*.42)))
   yield Image.alpha_composite(Image.alpha_composite(band,glow),ink)
 helpers.stream_rgba(target,frames());return target

def clean_composite(prefix,timed):
 target=OUT/f'{prefix}-clean-enhanced6-legible.mp4'
 revision=max(Path(__file__).stat().st_mtime,Path(clock_contour_effect.__file__).stat().st_mtime,timed.stat().st_mtime)
 if cached(target) and target.stat().st_mtime>=revision:return target
 hit=PLANS[prefix]['hit'];fx=OUT/f'{prefix}-native-clock-contours.mov'
 make_clock_fx(prefix,timed,fx,hit,FPS,W,H)
 subs=captions(prefix)
 camera='+'.join(f'0.045*exp(-pow((on/90-{cut})/.12,2))' for cut in PLANS[prefix]['cuts'])
 camera+=f'+0.055*gte(on/90,{hit})*exp(-max(on/90-{hit},0)*7)'
 decay=f'gte(t,{hit})*exp(-max(t-{hit},0)*4.5)'
 grade='hqdn3d=0.4:0.4:0.8:0.8,eq=saturation=1.05:brightness=0.02:contrast=1.05:gamma=1.035,unsharp=5:5:0.60:5:5:0,unsharp=13:13:0.32:13:13:0,unsharp=7:7:0.10:7:7:0,unsharp=13:13:0.10:13:13:0,eq=contrast=1.01,unsharp=5:5:0.16:5:5:0'
 graph=(f'[0:v]{grade}[base];'
  '[1:v]edgedetect=low=.04:high=.14,format=rgb24,colorchannelmixer=rr=.70:gg=.90:bb=1,format=yuv420p[neon];'
  "[base][neon]blend=all_expr='A*min(T/2.2,1)+B*(1-min(T/2.2,1))'[reveal];"
  '[reveal][2:v]overlay=0:0:format=auto[clockfx];'
  f"[clockfx]zoompan=z='1.025+{camera}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=90,"
  f"scale=1408:792,rotate='0.012*{decay}*sin(42*t)':c=black,crop=1280:720:"
  f"x='64+{decay}*(29*sin(75*floor(t*22.5)/22.5)+11*sin(111*floor(t*22.5)/22.5))':"
  f"y='36+{decay}*(20*sin(63*floor(t*22.5)/22.5)+8*sin(93*floor(t*22.5)/22.5))'[camera];"
  '[camera][3:v]overlay=0:0:format=auto,setsar=1,format=yuv420p[v]')
 print(prefix,'native visible-edge contours, shake, grade and flowing captions',flush=True)
 run([FF,'-hide_banner','-v','error','-y','-i',str(timed),'-i',str(timed),'-i',str(fx),'-i',str(subs),'-filter_complex',graph,'-map','[v]','-an','-frames:v','540','-r','90','-c:v','libx264','-preset','veryfast','-crf','16',str(target)])
 assert cached(target)
 return target

def soundtrack(prefix):
 if prefix!='649e948d':return HERE/'v3renders'/f'{prefix}-audio.wav'
 target=OUT/f'{prefix}-audio.wav'
 if target.exists():return target
 inputs=OUT/'audioinputs';inputs.mkdir(exist_ok=True)
 with wave.open(str(HERE/'v2renders'/f'{prefix}-duang.wav'),'rb') as source:
  params=source.getparams();pcm=np.frombuffer(source.readframes(source.getnframes()),dtype='<i2').reshape(-1,params.nchannels)
 shift=round((PLANS[prefix]['hit']-ORIGINAL_PLANS[prefix]['hit'])*params.framerate)
 moved=np.zeros_like(pcm);moved[shift:]=pcm[:-shift]
 with wave.open(str(inputs/f'{prefix}-duang.wav'),'wb') as dest:
  dest.setparams(params);dest.writeframes(moved.astype('<i2').tobytes())
 previous=helpers.V2
 try:
  helpers.V2=inputs
  return helpers.audio(prefix)
 finally:helpers.V2=previous

def render(prefix,master=True):
 timed=native_timed(prefix);base=clean_composite(prefix,timed)
 base=add_entrance(prefix,base,(FF,OUT,W,H,FPS,PLANS,helpers.stream_rgba,run))
 tail=helpers.water(prefix,base)
 audio=soundtrack(prefix)
 assert audio.exists()
 versions=[(3840,2160,'runtime','18M',60,'h264_nvenc')]
 if master:versions.append((7680,4320,'masters','42M',90,'hevc_nvenc'))
 for width,height,folder,bitrate,rate,codec in versions:
  dest=OUT/folder;dest.mkdir(exist_ok=True)
  filename=f'intro-{prefix}-{width}x{height}'+('-90fps' if folder=='masters' else '')+'.mp4'
  target=dest/filename
  if cached(target,rate*8) and target.stat().st_mtime>=max(base.stat().st_mtime,tail.stat().st_mtime,audio.stat().st_mtime):print('Cached',filename,flush=True);continue
  tag=['-tag:v','hvc1'] if codec=='hevc_nvenc' else []
  run([str(CAP),'-hide_banner','-v','error','-y','-i',str(base),'-i',str(tail),'-i',str(audio),
   '-filter_complex',f'[0:v][1:v]concat=n=2:v=1:a=0,settb=1/90,setpts=N,tpad=stop_mode=clone:stop_duration=0.1,fps={rate},scale={width}:{height}:flags=lanczos,setsar=1[v]',
   '-map','[v]','-map','2:a','-t','8','-frames:v',str(rate*8),'-r',str(rate),'-c:v',codec,'-preset','p5','-bf','0','-g',str(rate),'-b:v',bitrate,*tag,'-c:a','aac','-b:a','192k','-movflags','+faststart',str(target)])
  assert cached(target,rate*8)
  print('Ready',filename,target.stat().st_size,flush=True)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--clip');ap.add_argument('--runtime-only',action='store_true');args=ap.parse_args()
 order=['649e948d','0c5bbc22','142de3c3','5f85f09c']
 for prefix in order:
  if args.clip and prefix!=args.clip:continue
  render(prefix,not args.runtime_only)
