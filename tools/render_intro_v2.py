import os
"""Eight-second Kurumi edits: six seconds of curved timing plus two-second freeze."""
import argparse, json, math, subprocess, wave
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get('KURUMI_SOURCE_DIR', str(HERE/'source-material')))
OUT=HERE/'v2renders'; OUT.mkdir(exist_ok=True)
FF=os.environ.get('KURUMI_FFMPEG', 'ffmpeg')
PROBE=os.environ.get('KURUMI_FFPROBE', 'ffprobe')
PLANS={
 '0c5bbc22': {'src':[0,1.5,2.5,4.65,6.3], 'dst':[0,2.15,2.8,4.35,6], 'cuts':[2.15,2.8], 'hit':4.35},
 '142de3c3': {'src':[0,.65,2.45,3.25,6.07], 'dst':[0,1.0,2.75,3.6,6], 'cuts':[1.0,2.75], 'hit':3.6},
 '5f85f09c': {'src':[0,.7,1.35,1.85,3.56], 'dst':[0,1.8,2.55,3.5,6], 'cuts':[1.8,2.55], 'hit':3.5},
 '649e948d': {'src':[0,2.9,3.85,4.7,5.9], 'dst':[0,2.2,3.2,4.35,6], 'cuts':[3.2,4.35], 'hit':4.35}
}

def info(path):
 return json.loads(subprocess.check_output([PROBE,'-v','error','-show_entries','format=duration:stream=nb_frames,width,height,avg_frame_rate,sample_aspect_ratio','-of','json',str(path)]))

def timing(plan):
 expr='6'
 for a,b,c,d in reversed(list(zip(plan['src'][:-1],plan['src'][1:],plan['dst'][:-1],plan['dst'][1:]))):
  u=f'((T-{a})/{b-a})'
  curve=f'({u}-0.43/(2*PI)*sin(2*PI*{u}))'
  expr=f'if(lt(T,{b}),{c}+{d-c}*{curve},{expr})'
 return expr+'/TB'

def effects(prefix, hit):
 # Deterministic radial sparks and a short expanding shock ring.
 rng=np.random.default_rng(42)
 n=64; angles=rng.uniform(0,2*math.pi,n); velocities=rng.uniform(80,290,n)
 sizes=rng.uniform(.7,2.3,n); lives=rng.uniform(.45,1.15,n)
 target=OUT/f'{prefix}-particles.mov'
 proc=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s','640x360','-r','60','-i','-','-an','-c:v','qtrle',str(target)],stdin=subprocess.PIPE)
 for frame in range(360):
  t=frame/60-hit; im=Image.new('RGBA',(640,360)); draw=ImageDraw.Draw(im)
  if 0<=t<1.2:
   for i in range(n):
    if t>lives[i]:continue
    dist=35+velocities[i]*t
    x=320+math.cos(angles[i])*dist; y=180+math.sin(angles[i])*dist*.68+35*t*t
    alpha=int(225*(1-t/lives[i])**1.5); size=sizes[i]*(1-.4*t)
    color=(255,190+int(i%3)*20,110,alpha)
    tail=9*(1-t/lives[i]); dx=math.cos(angles[i])*tail;dy=math.sin(angles[i])*tail*.68
    draw.line((x-dx,y-dy,x,y),fill=color,width=max(1,int(size)))
   radius=35+340*t
   if t<.42:
    draw.ellipse((320-radius,180-radius*.68,320+radius,180+radius*.68),outline=(255,220,170,int(150*(1-t/.42))),width=2)
   if t<.055:draw.rectangle((0,0,640,360),fill=(255,217,185,int(75*(1-t/.055))))
  proc.stdin.write(im.tobytes())
 proc.stdin.close()
 if proc.wait()!=0:raise RuntimeError('Particle encoding failed')
 sr=48000;t=np.arange(sr*8)/sr;u=t-hit;v=np.maximum(u,0)
 envelope=np.exp(-v*5.2)*(u>=0)
 phase=2*math.pi*(48*v+(170-48)*(.085)*(1-np.exp(-v/.085)))
 sound=.72*np.sin(phase)*envelope
 for freq,amp,decay in [(385,.2,4.2),(647,.12,5.5),(1040,.07,7.5)]:
  sound+=amp*np.sin(2*math.pi*freq*v)*np.exp(-v*decay)*(u>=0)
 noise=rng.normal(0,1,len(t));sound+=.16*noise*np.exp(-v*34)*(u>=0)
 sound=np.tanh(sound*1.25)*.70
 stereo=np.stack((sound,np.roll(sound,110)*.96),axis=1)
 audio=OUT/f'{prefix}-duang.wav'
 with wave.open(str(audio),'wb') as w:
  w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((stereo*32767).astype('<i2').tobytes())
 return target,audio

def render(path,pilot=False):
 prefix=path.stem[:8];plan=PLANS[prefix];hit=plan['hit'];pts=timing(plan)
 particles,audio=effects(prefix,hit)
 w,h=(1280,720) if pilot else (3840,2160)
 camera='+'.join(f'0.045*exp(-pow((on/60-{cut})/.12,2))' for cut in plan['cuts'])
 camera+=f'+0.055*gte(on/60,{hit})*exp(-max(on/60-{hit},0)*7)'
 shake=f'gte(t,{hit})*exp(-max(t-{hit},0)*5.5)'
 graph=(f"[0:v]setpts='{pts}',minterpolate=fps=60:mi_mode=mci:mc_mode=obmc:me_mode=bidir:vsbmc=1,"
  'hqdn3d=1.0:1.0:2.0:2.0,scale=1280:720:flags=lanczos,setsar=1[base];'
  f"[1:v]setpts='{pts}',fps=60,scale=1280:720:flags=lanczos,edgedetect=low=.04:high=.14,"
  'format=rgb24,colorchannelmixer=rr=.18:gg=.78:bb=1,format=yuv420p[neon];'
  "[base][neon]blend=all_expr='A*min(T/2.2,1)+B*(1-min(T/2.2,1))'[reveal];"
  f"[reveal]zoompan=z='1.025+{camera}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=60[cam];"
  '[2:v]scale=1280:720[particles];[cam][particles]overlay=0:0:format=auto[fx];')
 if prefix=='649e948d':
  graph+=f'[3:v]format=rgba,colorchannelmixer=aa=.55,fade=t=in:st={hit-.25}:d=0.25:alpha=1[clock];[fx][clock]overlay=0:0:format=auto[clocked];'
  label='clocked'
 else:label='fx'
 graph+=(f'[{label}]scale=1320:742,crop=1280:720:'
  f"x='20+{shake}*(7*sin(81*floor(t*30)/30)+3*sin(117*floor(t*30)/30))':"
  f"y='11+{shake}*(5*sin(67*floor(t*30)/30)+2*sin(103*floor(t*30)/30))',"
  f'scale={w}:{h}:flags=lanczos,unsharp=5:5:.3:5:5:0,setsar=1,format=yuv420p[v]')
 dynamic=OUT/f'{prefix}-dynamic.mp4'
 cmd=[FF,'-hide_banner','-loglevel','error','-y','-i',str(path),'-i',str(path),'-i',str(particles)]
 if prefix=='649e948d':cmd+=['-loop','1','-i',str(HERE/'clock-overlay.png')]
 cmd+=['-filter_complex',graph,'-map','[v]','-an','-t','6','-r','60','-c:v','libx264','-preset','veryfast','-crf','18','-movflags','+faststart',str(dynamic)]
 print(f'{prefix}: rendering six-second edit, impact {hit}s',flush=True)
 subprocess.run(cmd,check=True)
 count=int(info(dynamic)['streams'][0]['nb_frames'])
 if not 350<=count<=360:raise RuntimeError(f'Unexpected dynamic frames {count}')
 target=OUT/f'intro-{prefix}-{w}x{h}.mp4'
 subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-i',str(dynamic),'-i',str(audio),
  '-vf',f'loop=loop={480-count}:size=1:start={count-1},setpts=N/(60*TB),setsar=1',
  '-map','0:v','-map','1:a','-frames:v','480','-t','8','-r','60','-c:v','libx264','-preset','veryfast','-crf','17',
  '-c:a','aac','-b:a','192k','-movflags','+faststart',str(target)],check=True)
 meta=info(target)
 if meta['streams'][0]['nb_frames']!='480' or abs(float(meta['format']['duration'])-8)>.025:raise RuntimeError(meta)
 print(f'{prefix}: ready {target.stat().st_size} bytes, 480 frames, 8 seconds',flush=True)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--pilot',action='store_true');ap.add_argument('--clip');args=ap.parse_args()
 for path in sorted(ROOT.glob('*.mp4')):
  if args.clip and not path.stem.startswith(args.clip):continue
  render(path,args.pilot)
