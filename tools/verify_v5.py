"""Verify staged 3s reveal exports and preserve approved source provenance."""
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from render_intro_v5 import FF, PROBE, OUT, PREVIOUS, ORDER, PLANS
from mix_zio_audio_v5 import decode as decode_audio, ANCHORS, DEST as AUDIO


def decode(path, start, length, rate=10):
    raw = subprocess.check_output([
        FF, '-v', 'error', '-xerror', '-ss', str(start), '-i', str(path),
        '-t', str(length), '-an', '-vf', f'fps={rate},scale=320:180',
        '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
    return np.frombuffer(raw, np.uint8).reshape(-1, 180, 320, 3).astype(np.float32)


def detail_energy(frame):
    gray = frame.mean(axis=2)
    lap = (4 * gray[1:-1, 1:-1] - gray[:-2, 1:-1] - gray[2:, 1:-1]
           - gray[1:-1, :-2] - gray[1:-1, 2:])
    return float(np.abs(lap).mean())


entries = []
audio_provenance = json.loads((AUDIO / 'provenance.json').read_text(encoding='utf-8'))
remux_report = json.loads((AUDIO / 'remux-report.json').read_text(encoding='utf-8'))
for folder, width, height, fps in [('runtime', 3840, 2160, 60), ('masters', 7680, 4320, 90)]:
    paths = sorted((OUT / folder).glob('intro-*.mp4'))
    assert len(paths) == 4, (folder, len(paths))
    for path in paths:
        metadata = json.loads(subprocess.check_output([
            PROBE, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)]))
        video = next(s for s in metadata['streams'] if s.get('codec_type') == 'video')
        audio = next(s for s in metadata['streams'] if s.get('codec_type') == 'audio')
        assert (video['width'], video['height']) == (width, height), video
        assert video['avg_frame_rate'] == f'{fps}/1', video
        assert int(video['nb_frames']) == fps * 8, video
        assert video['sample_aspect_ratio'] == '1:1', video
        assert abs(float(metadata['format']['duration']) - 8) < .04, metadata['format']
        if folder == 'runtime':
            subprocess.run([FF, '-v', 'error', '-xerror', '-i', str(path), '-f', 'null', '-'], check=True)
        frames = decode(path, 6, 2)
        assert len(frames) >= 19, (path, len(frames))
        ripple = float(np.abs(frames[1:10] - frames[0]).mean())
        blur_ratio = detail_energy(frames[9]) / max(.001, detail_energy(frames[0]))
        assert ripple > .01, (path, 'missing ripple', ripple)
        assert blur_ratio < .8, (path, 'missing progressive blur', blur_ratio)
        assert frames[-1].mean() < frames[0].mean() * .45, (path, 'missing final zoom')
        prefix = path.name.split('-')[1]
        expected_audio = decode_audio(AUDIO / f'{prefix}-original-voice-zio-bell.wav')
        actual_audio = decode_audio(path)
        assert abs(len(actual_audio) - len(expected_audio)) <= 1024, (path, len(actual_audio))
        expected_audio = expected_audio[:min(len(actual_audio), len(expected_audio))]
        actual_audio = actual_audio[:len(expected_audio)]
        audio_correlation = float(np.corrcoef(actual_audio.ravel(), expected_audio.ravel())[0, 1])
        audio_rmse = float(np.sqrt(np.mean((actual_audio - expected_audio) ** 2)))
        assert audio_correlation > .99 and audio_rmse < .02, (path, audio_correlation, audio_rmse)
        audio_source = next(r for r in audio_provenance if r['prefix'] == prefix)
        remux = next(r for r in remux_report if Path(r['path']) == path)
        assert remux['videoPacketHashBefore'] == remux['videoPacketHashAfter'], remux
        assert remux['sha256'] == hashlib.sha256(path.read_bytes()).hexdigest(), path
        assert audio['sample_rate'] == '48000' and audio['channels'] == 2, audio
        item = {
            'file': path.name, 'path': str(path), 'folder': folder,
            'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'width': width, 'height': height, 'fps': fps, 'frames': fps * 8,
            'durationSeconds': 8, 'lineRevealSeconds': 3, 'glitchSeconds': 1,
            'motionSeconds': 6, 'waterSeconds': 2, 'zoomOutSeconds': [7, 8],
            'exitBlurTarget': 70, 'preZoomDetailEnergyRatio': round(blur_ratio, 5),
            'rippleMeanPixelDeviation': round(ripple, 5), 'impactSeconds': PLANS[prefix]['hit'],
            'audioCodec': audio['codec_name'], 'audioStatus': 'original-voice-bgm-plus-single-unmodified-zio-bell',
            'bellStartSeconds': ANCHORS[prefix], 'bellSourceSha256': audio_source['sourceSha256'],
            'bellDurationSeconds': audio_source['sourceDecodedDurationSeconds'],
            'bellNaturalEndSeconds': audio_source['bellEndWithinEightSeconds'],
            'wholeMixConstantGain': audio_source['wholeMixConstantGain'],
            'audioDecodedCorrelationToMix': audio_correlation,
            'audioDecodedRmseToMix': audio_rmse,
            'videoPacketHash': remux['videoPacketHashAfter'],
            'clockSource': 'native-visible-fragments', 'syntheticClock': False}
        entries.append(item)
        print(json.dumps(item), flush=True)

comparisons = []
sheet = Image.new('RGB', (320 * 5, 204 * 4), (12, 12, 18))
draw = ImageDraw.Draw(sheet)
times = [0.4, 1.2, 2.2, 2.8, 3.2]
for row, prefix in enumerate(ORDER):
    provenance = json.loads((OUT / f'{prefix}-reveal3s.done.json').read_text(encoding='utf-8'))
    for record in provenance['reusedFiles']:
        p = Path(record['path'])
        assert hashlib.sha256(p.read_bytes()).hexdigest() == record['sha256'], p
    current = OUT / f'{prefix}-clean-reveal3s6.mp4'
    previous = PREVIOUS / f'{prefix}-clean-enhanced6-legible.mp4'
    differences = {}
    for time in [1.5, 2.5, 3.5, 5.5]:
        old = decode(previous, time, .1, 10)[0]
        new = decode(current, time, .1, 10)[0]
        differences[str(time)] = round(float(np.abs(new - old).mean()), 5)
    # The reveal must change before 3s; the rest retains the same imagery.
    assert differences['1.5'] > .05 and differences['2.5'] > .05, differences
    assert differences['3.5'] < 2 and differences['5.5'] < 2, differences
    comparisons.append({'prefix': prefix, 'meanPixelDifferenceVsV4': differences})
    path = OUT / f'{prefix}-entrance4206.mp4'
    for col, time in enumerate(times):
        frame = decode(path, time, .1, 10)[0].astype(np.uint8)
        sheet.paste(Image.fromarray(frame), (col * 320, row * 204 + 24))
        draw.text((col * 320 + 8, row * 204 + 6), f'{prefix}  {time:.1f}s', fill=(240, 240, 245))
sheet.save(OUT / 'reveal3s-contact-sheet.jpg', quality=94)
manifest = {'lineRevealSeconds': 3, 'durationSeconds': 8, 'audioPendingReplacement': False,
            'comparisons': comparisons, 'films': entries}
(OUT / 'verified-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print('Verified all 8 staged 3s-reveal films', flush=True)
