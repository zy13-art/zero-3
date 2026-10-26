"""Extend the approved fluorescence reveal to 3s; retain the 8s edit.

Reuses v4 optical-flow footage, native clock fragments, captions, and the
approved 2s water/zoom ending. This renderer only stages files in v5renders.
"""
import argparse
import hashlib
import json
from pathlib import Path

import render_intro_v4 as v4
from intro_effect_v3 import add_entrance

HERE = Path(__file__).resolve().parent
PREVIOUS = HERE / 'v4renders'
OUT = HERE / 'v5renders'
OUT.mkdir(exist_ok=True)
FF, PROBE, CAP = v4.FF, v4.PROBE, v4.CAP
W, H, FPS = v4.W, v4.H, v4.FPS
PLANS = v4.PLANS
LINE_REVEAL_SECONDS = 3.0
ORDER = ['649e948d', '0c5bbc22', '142de3c3', '5f85f09c']
run, cached = v4.run, v4.cached


def approved_input(prefix, suffix, frames=540):
    path = PREVIOUS / f'{prefix}-{suffix}'
    assert path.exists(), path
    assert cached(path, frames), path
    return path


def clean_composite(prefix):
    target = OUT / f'{prefix}-clean-reveal3s6.mp4'
    timed = approved_input(prefix, 'native-timed6.mp4')
    fx = approved_input(prefix, 'native-clock-contours.mov')
    subs = approved_input(prefix, f'captions-hit{PLANS[prefix]["hit"]:.2f}.mov')
    revision = max(Path(__file__).stat().st_mtime,
                   *(p.stat().st_mtime for p in [timed, fx, subs]))
    if cached(target) and target.stat().st_mtime >= revision:
        return target
    hit = PLANS[prefix]['hit']
    camera = '+'.join(f'0.045*exp(-pow((on/90-{cut})/.12,2))'
                      for cut in PLANS[prefix]['cuts'])
    camera += f'+0.055*gte(on/90,{hit})*exp(-max(on/90-{hit},0)*7)'
    decay = f'gte(t,{hit})*exp(-max(t-{hit},0)*4.5)'
    grade = ('hqdn3d=0.4:0.4:0.8:0.8,'
             'eq=saturation=1.05:brightness=0.02:contrast=1.05:gamma=1.035,'
             'unsharp=5:5:0.60:5:5:0,unsharp=13:13:0.32:13:13:0,'
             'unsharp=7:7:0.10:7:7:0,unsharp=13:13:0.10:13:13:0,'
             'eq=contrast=1.01,unsharp=5:5:0.16:5:5:0')
    graph = (
        f'[0:v]{grade}[base];'
        '[1:v]edgedetect=low=.04:high=.14,format=rgb24,'
        'colorchannelmixer=rr=.70:gg=.90:bb=1,format=yuv420p[neon];'
        f"[base][neon]blend=all_expr='A*min(T/{LINE_REVEAL_SECONDS},1)"
        f"+B*(1-min(T/{LINE_REVEAL_SECONDS},1))'[reveal];"
        '[reveal][2:v]overlay=0:0:format=auto[clockfx];'
        f"[clockfx]zoompan=z='1.025+{camera}':x='iw/2-iw/zoom/2':"
        "y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=90,"
        f"scale=1408:792,rotate='0.012*{decay}*sin(42*t)':c=black,"
        f"crop=1280:720:x='64+{decay}*(29*sin(75*floor(t*22.5)/22.5)"
        f"+11*sin(111*floor(t*22.5)/22.5))':y='36+{decay}*"
        "(20*sin(63*floor(t*22.5)/22.5)+8*sin(93*floor(t*22.5)/22.5))'[camera];"
        '[camera][3:v]overlay=0:0:format=auto,setsar=1,format=yuv420p[v]'
    )
    print(prefix, 'rendering 3s fluorescence with approved native contours', flush=True)
    run([FF, '-hide_banner', '-v', 'error', '-y', '-i', str(timed),
         '-i', str(timed), '-i', str(fx), '-i', str(subs),
         '-filter_complex', graph, '-map', '[v]', '-an', '-frames:v', '540',
         '-r', '90', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', str(target)])
    assert cached(target)
    return target


def render(prefix, master=True):
    base = clean_composite(prefix)
    # This unchanged helper keeps the pixel/window glitch at exactly 1s.
    base = add_entrance(prefix, base,
        (FF, OUT, W, H, FPS, PLANS, v4.helpers.stream_rgba, run))
    assert cached(base)
    tail = approved_input(prefix, 'water420.mp4', 180)
    audio = (PREVIOUS if prefix == '649e948d' else HERE / 'v3renders') / f'{prefix}-audio.wav'
    assert audio.exists(), audio
    versions = [(3840, 2160, 'runtime', '18M', 60, 'h264_nvenc')]
    if master:
        versions.append((7680, 4320, 'masters', '42M', 90, 'hevc_nvenc'))
    for width, height, folder, bitrate, rate, codec in versions:
        dest = OUT / folder
        dest.mkdir(exist_ok=True)
        filename = f'intro-{prefix}-{width}x{height}' + ('-90fps' if folder == 'masters' else '') + '.mp4'
        target = dest / filename
        if cached(target, rate * 8) and target.stat().st_mtime >= max(
                base.stat().st_mtime, tail.stat().st_mtime, audio.stat().st_mtime):
            print('Cached', filename, flush=True)
            continue
        tag = ['-tag:v', 'hvc1'] if codec == 'hevc_nvenc' else []
        print(prefix, 'encoding', folder, flush=True)
        run([str(CAP), '-hide_banner', '-v', 'error', '-y', '-i', str(base),
             '-i', str(tail), '-i', str(audio), '-filter_complex',
             f'[0:v][1:v]concat=n=2:v=1:a=0,settb=1/90,setpts=N,'
             f'tpad=stop_mode=clone:stop_duration=0.1,fps={rate},'
             f'scale={width}:{height}:flags=lanczos,setsar=1[v]',
             '-map', '[v]', '-map', '2:a', '-t', '8', '-frames:v', str(rate * 8),
             '-r', str(rate), '-c:v', codec, '-preset', 'p5', '-bf', '0',
             '-g', str(rate), '-b:v', bitrate, *tag, '-c:a', 'aac', '-b:a', '192k',
             '-movflags', '+faststart', str(target)])
        assert cached(target, rate * 8)
        print('Ready', filename, target.stat().st_size, flush=True)
    provenance = {
        'prefix': prefix, 'lineRevealSeconds': LINE_REVEAL_SECONDS,
        'glitchSeconds': 1, 'motionSeconds': 6, 'waterSeconds': 2,
        'zoomOutSeconds': [7, 8], 'durationSeconds': 8,
        'clockSource': 'approved-v4-native-visible-fragments', 'syntheticClock': False,
        'audioStatus': 'approved-v4-audio-pending-parent-replacement',
        'reusedFiles': [
            {'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in [PREVIOUS / f'{prefix}-native-timed6.mp4',
                      PREVIOUS / f'{prefix}-native-clock-contours.mov',
                      PREVIOUS / f'{prefix}-captions-hit{PLANS[prefix]["hit"]:.2f}.mov',
                      tail, audio]
        ]
    }
    (OUT / f'{prefix}-reveal3s.done.json').write_text(
        json.dumps(provenance, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--clip', choices=ORDER)
    parser.add_argument('--runtime-only', action='store_true')
    args = parser.parse_args()
    for prefix in ORDER:
        if args.clip and prefix != args.clip:
            continue
        render(prefix, not args.runtime_only)
