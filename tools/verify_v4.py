import hashlib,json,subprocess
from pathlib import Path
import numpy as np
from render_intro_v4 import FF,PROBE,PLANS

root=Path(__file__).resolve().parent/'v4renders'
entries=[]
for folder,width,height,fps in [('runtime',3840,2160,60),('masters',7680,4320,90)]:
    paths=sorted((root/folder).glob('intro-*.mp4'))
    assert len(paths)==4,(folder,len(paths))
    for path in paths:
        meta=json.loads(subprocess.check_output([PROBE,'-v','error','-show_streams','-show_format','-of','json',str(path)]))
        v=next(s for s in meta['streams'] if s.get('codec_type')=='video')
        a=next(s for s in meta['streams'] if s.get('codec_type')=='audio')
        assert (v['width'],v['height'])==(width,height),v
        assert v['avg_frame_rate']==f'{fps}/1' and int(v['nb_frames'])==fps*8,v
        assert v['sample_aspect_ratio']=='1:1',v
        assert abs(float(meta['format']['duration'])-8)<.04,meta['format']
        if folder=='runtime':subprocess.run([FF,'-v','error','-xerror','-i',str(path),'-f','null','-'],check=True)
        raw=subprocess.check_output([FF,'-v','error','-xerror','-ss','6','-i',str(path),'-an','-vf','fps=10,scale=320:180','-pix_fmt','rgb24','-f','rawvideo','-'])
        frames=np.frombuffer(raw,np.uint8).reshape(-1,180,320,3).astype(np.float32)
        assert len(frames)>=19
        ripple=float(np.abs(frames[1:10]-frames[0]).mean())
        assert ripple>.01,(path,'missing water movement',ripple)
        def detail_energy(frame):
            gray=frame.mean(axis=2)
            lap=4*gray[1:-1,1:-1]-gray[:-2,1:-1]-gray[2:,1:-1]-gray[1:-1,:-2]-gray[1:-1,2:]
            return float(np.abs(lap).mean())
        blur_ratio=detail_energy(frames[9])/max(.001,detail_energy(frames[0]))
        assert blur_ratio<.8,(path,'progressive exit blur not visible',blur_ratio)
        assert frames[-1].mean()<frames[0].mean()*.45,(path,'missing zoom exit')
        prefix=path.name.split('-')[1]
        item=dict(file=path.name,folder=folder,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),width=width,height=height,fps=fps,frames=fps*8,durationSeconds=8,motionSeconds=6,rippleSeconds=2,zoomOutSeconds=[7,8],exitBlurTarget=70,preZoomDetailEnergyRatio=round(blur_ratio,5),impactSeconds=PLANS[prefix]['hit'],rippleMeanPixelDeviation=round(ripple,5),audioCodec=a['codec_name'],clockSource='native-visible-fragments',syntheticClock=False)
        entries.append(item);print(json.dumps(item),flush=True)
module=hashlib.sha256((root.parent/'clock_contour_effect.py').read_bytes()).hexdigest()
actual_hashes={row['file']:row['sha256'] for row in entries}
for prefix in ['0c5bbc22','142de3c3','5f85f09c','649e948d']:
    marker=json.loads((root/f'{prefix}-legible-fx.done.json').read_text())
    # Markers also record final hashes; the main manifest below checks installed copies.
    assert module in json.dumps(marker),(prefix,'contour module changed after final render')
    for record in marker['files']:
        assert actual_hashes[Path(record['path']).name]==record['sha256'],(prefix,'final file differs from refreshed contour render')
(root/'verified-manifest.json').write_text(json.dumps(dict(version='1.3.0',lineRevealSeconds=2.2,films=entries),indent=2),encoding='utf-8')
print('Verified all8 clean-source native-clock films')
