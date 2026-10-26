"""Equivalent pixel/glitch-window reveal from user's 5.57-second CapCut recording."""
import math,subprocess
import numpy as np
from PIL import Image,ImageDraw,ImageFilter,ImageOps,ImageFont

def add_entrance(prefix,base,env):
    FF,OUT,W,H,FPS,PLANS,stream,run=env
    target=OUT/f'{prefix}-entrance4206.mp4'
    if target.exists() and target.stat().st_mtime>base.stat().st_mtime:return target
    decoder=subprocess.Popen([FF,'-v','error','-i',str(base),'-t','1','-pix_fmt','rgb24','-f','rawvideo','-'],stdout=subprocess.PIPE)
    rng=np.random.default_rng(761)
    tiles=[]
    for y in range(0,H,72):
        for x in range(0,W,128):
            # Subject-centred pieces reveal first, outward fragments follow.
            distance=math.hypot((x+64-W/2)/W,(y+36-H/2)/H)
            tiles.append((x,y,min(x+128,W),min(y+72,H),float(rng.uniform(0,.45)+distance*.45)))
    font=ImageFont.truetype(r'C:\Windows\Fonts\segoeui.ttf',12)
    windows=[(75,105,245,98),(850,125,280,102),(140,450,240,95),(900,440,255,106),(370,62,225,90),(625,530,240,95)]
    first_end=PLANS[prefix]['dst'][1]
    def inverse(t):
        lo,hi=0.,1.
        for _ in range(24):
            u=(lo+hi)/2
            if first_end*(u-.43/(2*math.pi)*math.sin(2*math.pi*u))<t:lo=u
            else:hi=u
        return (lo+hi)/2
    denominator=inverse(1.)
    def frames():
        for n in range(FPS):
            raw=decoder.stdout.read(W*H*3)
            if len(raw)!=W*H*3:raise RuntimeError('Entrance decoder ended early')
            source=Image.frombytes('RGB',(W,H),raw).convert('RGBA')
            t=n/FPS;p=min(1,inverse(t)/denominator);settle=max(0,min(1,(p-.74)/.26))
            edge=ImageOps.grayscale(source.convert('RGB')).filter(ImageFilter.FIND_EDGES)
            edge=ImageOps.autocontrast(edge,cutoff=1)
            outlines=Image.new('RGBA',(W,H),(210,234,255,255));outlines.putalpha(edge)
            # Start with bright white edges, then allow colour into the revealed pieces.
            detailed=Image.blend(outlines,source,min(1,p*1.3))
            canvas=Image.new('RGBA',(W,H),(2,3,10,255))
            for x0,y0,x1,y1,threshold in tiles:
                if p<threshold:continue
                crop=detailed.crop((x0,y0,x1,y1))
                pulse=math.sin(math.floor(t*24)*2.3+y0*.027+x0*.019)
                offset=round((1-settle)*(1-p)*34*pulse)
                canvas.alpha_composite(crop,(x0+offset,y0))
            # The same source frame stays underneath each synthetic window.
            ui=Image.new('RGBA',(W,H));draw=ImageDraw.Draw(ui)
            opacity=int(220*min(1,max(0,(p-.14)/.24))*(1-settle))
            for i,(x,y,w,h) in enumerate(windows):
                if p<.15+i*.065:continue
                jitter=round(10*(1-settle)*math.sin(math.floor(t*20)*1.8+i))
                x+=jitter;yy=y+jitter//2
                draw.rectangle((x,yy,x+w,yy+h),fill=(6,7,14,opacity),outline=(210,211,225,opacity),width=1)
                draw.rectangle((x,yy,x+w,yy+13),fill=(207,204,221,opacity))
                draw.text((x+5,yy+1),'ZAPHKIEL',font=font,fill=(28,17,44,opacity))
                draw.ellipse((x+10,yy+31,x+30,yy+51),outline=(224,126,255,opacity),width=2)
                draw.line((x+15,yy+36,x+25,yy+46),fill=(224,126,255,opacity),width=2)
                draw.line((x+25,yy+36,x+15,yy+46),fill=(224,126,255,opacity),width=2)
                draw.text((x+39,yy+32),'Serious error occurred',font=font,fill=(229,228,244,opacity))
                draw.rectangle((x+w-55,yy+h-23,x+w-12,yy+h-8),outline=(205,205,222,opacity))
                draw.text((x+w-42,yy+h-24),'OK',font=font,fill=(224,224,240,opacity))
            canvas=Image.alpha_composite(canvas,ui.filter(ImageFilter.GaussianBlur(3)))
            canvas=Image.alpha_composite(canvas,ui)
            # Clean merge at one second; the continuing 2.2s line reveal is retained.
            yield Image.blend(canvas,source,settle)
        decoder.stdout.close();decoder.wait()
    layer=OUT/f'{prefix}-pixel-window1.mov';stream(layer,frames())
    run([FF,'-v','error','-y','-i',str(layer),'-i',str(base),'-filter_complex',
         '[1:v]trim=start=1,setpts=PTS-STARTPTS[rest];[0:v][rest]concat=n=2:v=1:a=0,settb=1/90,setpts=N,setsar=1,format=yuv420p[v]',
         '-map','[v]','-an','-frames:v','540','-r','90','-c:v','libx264','-preset','veryfast','-crf','16',str(target)])
    return target
