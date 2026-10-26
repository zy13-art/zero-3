import os
"""Particles and short contour echoes derived only from currently visible source edges.

This module never draws a dial, a circle, hands, numerals or missing gears.  The
spatial masks select clock-background regions and exclude Kurumi; they are not
rendered.  Every illuminated pixel comes from an edge in the current source
frame, including the incomplete red summoning contours in clip 2.
"""
from pathlib import Path
import math
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

FF = os.environ.get('KURUMI_FFMPEG', 'ffmpeg')
KNOWN_CLOCKS = {'0c5bbc22', '142de3c3', '5f85f09c', '649e948d'}


def _background_mask(prefix, width, height):
    """Broad, conservative spatial gates; no assumed missing clock structure."""
    mask = Image.new('L', (width, height))
    d = ImageDraw.Draw(mask)
    def polygon(points, fill):
        d.polygon([(round(x*width), round(y*height)) for x,y in points], fill=fill)
    if prefix == '0c5bbc22':
        # Orange/gold clock pieces enter around the central character.
        d.rectangle((0, round(.07*height), width, round(.87*height)), fill=255)
        polygon([(.43,0),(.58,0),(.61,.35),(.69,.58),(.73,1),(.27,1),(.33,.60),(.39,.34)], 0)
    elif prefix == '142de3c3':
        # Red/black partial summoning structure; never infer a completed dial.
        d.rectangle((0, 0, width, round(.90*height)), fill=255)
        polygon([(.43,.07),(.58,.07),(.63,.30),(.73,.52),(.79,1),(.25,1),(.30,.50),(.39,.26)], 0)
    elif prefix == '5f85f09c':
        # Clock fills the gym background; gate out ceiling sides and floor.
        d.ellipse((round(.04*width), round(-.28*height), round(.96*width), round(1.23*height)), fill=255)
        d.rectangle((0, round(.87*height), width, height), fill=0)
        polygon([(.455,.30),(.55,.30),(.58,.48),(.69,.68),(.72,1),(.27,1),(.31,.68),(.42,.48)], 0)
    elif prefix == '649e948d':
        # The native silver clock rises from below in the final source moments.
        # Keep the original visible side/rim fragments, excluding the raised
        # arm, central figure, and baked subtitles.  No circle is supplied here.
        d.rectangle((0, 0, width, round(.87*height)), fill=255)
        polygon([(.48,0),(.54,0),(.55,.32),(.60,.46),(.60,.68),(.70,1),(.30,1),(.36,.70),(.40,.47),(.46,.31)], 0)
    return mask.filter(ImageFilter.GaussianBlur(1.2))


def _visible_edges(frame, prefix, region):
    rgb = np.asarray(frame.convert('RGB'), dtype=np.float32)
    r,g,b = rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
    if prefix == '142de3c3':
        # Keep only the actual bright red summoning perimeter, not dark inferred detail.
        color = (r > 75) & (r > g*1.45) & (r > b*1.20)
    elif prefix == '649e948d':
        # Silver/ivory dial plus warm gears; reject saturated purple clouds.
        maximum=np.maximum(np.maximum(r,g),b);minimum=np.minimum(np.minimum(r,g),b)
        neutral=(minimum>50)&((maximum-minimum)<maximum*.33)
        warm=(r>75)&(g>r*.45)&(g>b*.93)&(r>g*.90)
        color=neutral|warm
    else:
        # Gold/ivory clock structures, excluding pure red smoke and blue scenery.
        color = (r > 75) & (g > r*.30) & (g > b*.93) & (r > g*.87)
    edge = np.asarray(ImageOps.grayscale(frame).filter(ImageFilter.FIND_EDGES), dtype=np.float32)
    # Edge filtering is done before the spatial gate, so mask boundaries do not
    # become invented outlines.
    values = np.clip((edge-8)*4.0, 0, 210) * color
    values *= np.asarray(region, dtype=np.float32)/255
    values[:3] = 0; values[-3:] = 0; values[:,:3] = 0; values[:,-3:] = 0
    return Image.fromarray(values.astype(np.uint8), 'L')


def _expanded(mask, center, scale):
    cx,cy = center
    return mask.transform(mask.size, Image.Transform.AFFINE,
                          (1/scale,0,cx*(1-1/scale),0,1/scale,cy*(1-1/scale)),
                          Image.Resampling.BICUBIC)


def make_clock_fx(prefix, timed_video, dest, hit, fps=90, width=1280, height=720):
    """Encode six-second RGBA qtrle overlay from current native clock edges.

    timed_video must be a clean six-second retimed source, before particle
    overlays.  During the event the decoder supplies the SAME current frame;
    no complete clock template is sampled from a later frame.
    """
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    total = round(6*fps)
    first = math.ceil(hit*fps)
    event_count = min(total-first, math.ceil(.86*fps))
    decoder = None
    if prefix in KNOWN_CLOCKS:
        decoder = subprocess.Popen([FF,'-v','error','-ss',f'{first/fps:.9f}',
            '-i',str(timed_video),'-an','-vf',f'scale={width}:{height},fps={fps}',
            '-frames:v',str(event_count),'-pix_fmt','rgb24','-f','rawvideo','-'],stdout=subprocess.PIPE)
    encoder = subprocess.Popen([FF,'-v','error','-y','-f','rawvideo','-pix_fmt','rgba',
        '-s',f'{width}x{height}','-r',str(fps),'-i','-','-an','-c:v','qtrle',str(dest)],stdin=subprocess.PIPE)
    region = _background_mask(prefix,width,height)
    center = (.5*width,.49*height)
    if prefix == '142de3c3': center=(.48*width,.51*height)
    rng=np.random.default_rng(4159+sum(map(ord,prefix)))
    births=np.linspace(0,.20,136)
    next_birth=0; sparks=[]; preview_saved=False
    transparent=bytes(width*height*4)
    try:
        for n in range(total):
            if decoder is None or n<first or n>=first+event_count:
                encoder.stdin.write(transparent)
                continue
            raw=decoder.stdout.read(width*height*3)
            if len(raw)!=width*height*3:
                raise RuntimeError(f'{prefix}: current-frame contour decoder ended early at {n/fps:.3f}s')
            source=Image.frombytes('RGB',(width,height),raw)
            edge=_visible_edges(source,prefix,region)
            u=n/fps-hit
            if prefix=='649e948d':
                # Direction origin follows the rising native clock.  This is
                # only a velocity origin; it never draws or completes a shape.
                center=(.5*width,height*(.86-.26*min(1,max(0,u)/.55)))
            im=Image.new('RGBA',(width,height))
            # Echos expand only the current visible fragments.  Missing arcs
            # and hidden gears stay absent, even while the source is forming.
            for lag,strength in [(0,1.0),(.12,.38)]:
                phase=u-lag
                if not 0<=phase<.62: continue
                scale=1+.17*(1-math.exp(-phase*4.2))
                alpha=_expanded(edge,center,scale)
                alpha=alpha.point(lambda a:round(a*strength*(1-phase/.62)**.90))
                contour=Image.new('RGBA',(width,height),(255,242,209,0));contour.putalpha(alpha)
                glow=contour.filter(ImageFilter.GaussianBlur(2.2))
                glow.putalpha(glow.getchannel('A').point(lambda a:round(a*.35)))
                im=Image.alpha_composite(im,glow)
                im=Image.alpha_composite(im,contour)
            ys,xs=np.where(np.asarray(edge)>55)
            while next_birth<len(births) and births[next_birth]<=u:
                if len(xs):
                    j=int(rng.integers(len(xs)));x=float(xs[j]);y=float(ys[j])
                    dx=x-center[0];dy=y-center[1];length=max(1,math.hypot(dx,dy))
                    angle=math.atan2(dy,dx)+rng.normal(0,.10)
                    speed=float(rng.uniform(72,225))*width/1280
                    life=float(rng.uniform(.34,.62))
                    sparks.append((x,y,math.cos(angle)*speed,math.sin(angle)*speed,u,life,float(rng.uniform(.8,1.6))))
                next_birth+=1
            draw=ImageDraw.Draw(im)
            for x,y,vx,vy,born,life,size in sparks:
                age=u-born
                if not 0<=age<life:continue
                xx=x+vx*age; yy=y+vy*age+12*age*age
                a=round(205*(1-age/life)**1.45)
                trail=.022+.020*(1-age/life)
                draw.line((xx-vx*trail,yy-vy*trail,xx,yy),fill=(255,209,125,a),width=max(1,round(size)))
            if not preview_saved and .24<=u<.28:
                im.save(dest.with_suffix('.preview.png'))
                Image.alpha_composite(source.convert('RGBA'),im).save(dest.with_suffix('.composite.png'))
                edge.save(dest.with_suffix('.edge-mask.png'))
                preview_saved=True
            encoder.stdin.write(im.tobytes())
        encoder.stdin.close()
        if encoder.wait():raise RuntimeError('Contour overlay encoder failed')
        if decoder is not None:
            decoder.stdout.close()
            if decoder.wait():raise RuntimeError('Contour frame decoder failed')
    except BaseException:
        encoder.stdin.close()
        encoder.wait()
        if decoder is not None:
            decoder.stdout.close()
            decoder.terminate()
            decoder.wait()
        raise
    return dest
