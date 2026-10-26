"""Export the approved original voice/BGM timing without generated impact audio."""
import hashlib
import json
import subprocess
from render_intro_v5 import FF, OUT, ORDER, PLANS, v4

dest = OUT / 'clean-audio'
dest.mkdir(exist_ok=True)
records = []
for prefix in ORDER:
    source = next(v4.ROOT.glob(prefix + '*.mp4'))
    plan = PLANS[prefix]
    filters, labels = [], []
    for i, (a, b, c, d) in enumerate(zip(plan['src'][:-1], plan['src'][1:],
                                         plan['dst'][:-1], plan['dst'][1:])):
        rate = (b - a) / (d - c)
        tempo = []
        while rate < .5:
            tempo.append('atempo=0.5')
            rate /= .5
        while rate > 2:
            tempo.append('atempo=2')
            rate /= 2
        tempo.append(f'atempo={rate:.8f}')
        filters.append(f'[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS,'
                       + ','.join(tempo) + f'[a{i}]')
        labels.append(f'[a{i}]')
    filters.append(''.join(labels)
                   + f'concat=n={len(labels)}:v=0:a=1,apad,atrim=duration=8,volume=0.55[voice]')
    target = dest / f'{prefix}-original-voice-bgm.wav'
    subprocess.run([FF, '-hide_banner', '-v', 'error', '-y', '-i', str(source),
                    '-filter_complex', ';'.join(filters), '-map', '[voice]',
                    '-t', '8', str(target)], check=True)
    records.append({'prefix': prefix, 'path': str(target),
                    'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                    'source': str(source), 'syntheticImpactRemoved': True,
                    'volume': 0.55, 'durationSeconds': 8})
    print(target, flush=True)
(dest / 'manifest.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
