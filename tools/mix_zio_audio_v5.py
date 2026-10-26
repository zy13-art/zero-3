"""One unmodified Zi-O bell, delayed to each native clock's full appearance.

No tempo/pitch/envelope changes, repeats, ticking, reverb, or compression.
Only one constant gain may be applied to the entire voice/BGM + bell mix.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from render_intro_v5 import CAP, HERE, OUT, ORDER

SOURCE = HERE.parent / 'assets' / 'zio-clock.mp3'
SOURCE_URL = 'https://www.myinstants.com/en/instant/zi-o-clock-sound-81953/'
ANCHORS = {'0c5bbc22': 4.50, '142de3c3': 5.75,
           '5f85f09c': 3.70, '649e948d': 5.60}
RATE, CHANNELS, SECONDS = 48000, 2, 8
DEST = OUT / 'audio'
DEST.mkdir(exist_ok=True)


def decode(path):
    raw = subprocess.check_output([
        str(CAP), '-hide_banner', '-v', 'error', '-i', str(path), '-vn',
        '-ar', str(RATE), '-ac', str(CHANNELS), '-c:a', 'pcm_f32le',
        '-f', 'f32le', '-'])
    return np.frombuffer(raw, dtype='<f4').reshape(-1, CHANNELS).copy()


def mix():
    bell = decode(SOURCE)
    assert 2.4 <= len(bell) / RATE <= 2.7, len(bell)
    source_sha = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    records = []
    for prefix in ORDER:
        clean = OUT / 'clean-audio' / f'{prefix}-original-voice-bgm.wav'
        voice = decode(clean)
        assert len(voice) == RATE * SECONDS, (clean, voice.shape)
        delayed = np.zeros_like(voice)
        first = round(ANCHORS[prefix] * RATE)
        retained = min(len(bell), len(voice) - first)
        delayed[first:first + retained] = bell[:retained]
        combined = voice.astype(np.float64) + delayed
        peak = float(np.abs(combined).max())
        gain = min(1., .98 / max(peak, 1e-12))
        combined *= gain
        target = DEST / f'{prefix}-original-voice-zio-bell.wav'
        subprocess.run([
            str(CAP), '-hide_banner', '-v', 'error', '-y', '-f', 'f32le',
            '-ar', str(RATE), '-ac', str(CHANNELS), '-i', '-', '-c:a', 'pcm_s24le',
            str(target)], input=combined.astype('<f4').tobytes(), check=True)
        actual = decode(target)
        error = float(np.max(np.abs(actual - combined)))
        assert error < 2e-6, (prefix, error)
        assert np.abs(actual).max() <= .98001, (prefix, np.abs(actual).max())
        # Subtract the dry stem to prove that the bell is only delayed and
        # uniformly scaled, with its original samples and natural decay.
        recovered = actual.astype(np.float64) / gain - voice
        envelope_error = float(np.max(np.abs(recovered - delayed)))
        assert envelope_error < 3e-6, (prefix, envelope_error)
        end_rms = float(np.sqrt(np.mean(recovered[-RATE // 4:] ** 2)))
        item = {
            'prefix': prefix, 'path': str(target),
            'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
            'source': str(SOURCE), 'sourceUrl': SOURCE_URL, 'sourceSha256': source_sha,
            'sourceNativeSampleRate': 44100, 'sourceNativeChannels': 2,
            'mixSampleRate': RATE, 'mixChannels': CHANNELS,
            'sourceDecodedFramesAtMixRate': len(bell),
            'sourceDecodedDurationSeconds': len(bell) / RATE,
            'bellStartSeconds': ANCHORS[prefix], 'bellStartFrame': first,
            'bellSamplesRetained': retained, 'bellSamplesCutAtEightSeconds': len(bell) - retained,
            'bellEndWithinEightSeconds': min(SECONDS, ANCHORS[prefix] + len(bell) / RATE),
            'bellSpeed': 1, 'bellPitchChanged': False, 'bellRepeats': 1,
            'bellReverbAdded': False, 'bellEnvelopeChanged': False, 'tickingAdded': False,
            'generatedDuangIncluded': False, 'durationSeconds': SECONDS,
            'cleanStem': str(clean), 'cleanStemSha256': hashlib.sha256(clean.read_bytes()).hexdigest(),
            'wholeMixConstantGain': gain, 'preGainPeak': peak,
            'postGainPeak': float(np.abs(actual).max()),
            'pcmMixMaximumSampleError': error,
            'recoveredBellMaximumSampleError': envelope_error,
            'recoveredBellFinalQuarterSecondRms': end_rms,
        }
        records.append(item)
        print(json.dumps(item), flush=True)
    (DEST / 'provenance.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
    return records


def video_hash(path):
    return subprocess.check_output([
        str(CAP), '-v', 'error', '-i', str(path), '-map', '0:v:0',
        '-c:v', 'copy', '-an', '-f', 'hash', '-hash', 'sha256', '-'
    ]).decode('ascii').strip()


def remux():
    records = json.loads((DEST / 'provenance.json').read_text(encoding='utf-8'))
    report = []
    for prefix in ORDER:
        audio = next(Path(row['path']) for row in records if row['prefix'] == prefix)
        for folder in ['runtime', 'masters']:
            paths = list((OUT / folder).glob(f'intro-{prefix}-*.mp4'))
            assert len(paths) == 1, paths
            target = paths[0]
            previous_hash = video_hash(target)
            temporary = target.with_name(target.stem + '.new-audio.mp4')
            subprocess.run([
                str(CAP), '-hide_banner', '-v', 'error', '-y', '-i', str(target),
                '-i', str(audio), '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '0',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', str(RATE),
                '-ac', str(CHANNELS), '-t', str(SECONDS), '-movflags', '+faststart',
                str(temporary)], check=True)
            after_hash = video_hash(temporary)
            assert previous_hash == after_hash, (target, previous_hash, after_hash)
            temporary.replace(target)
            record = {'path': str(target), 'bytes': target.stat().st_size,
                      'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                      'videoPacketHashBefore': previous_hash,
                      'videoPacketHashAfter': after_hash,
                      'audio': str(audio), 'audioBitrate': 256000}
            report.append(record)
            print('Remuxed', json.dumps(record), flush=True)
        marker = OUT / f'{prefix}-reveal3s.done.json'
        provenance = json.loads(marker.read_text(encoding='utf-8'))
        provenance['audioStatus'] = 'original-voice-bgm-plus-single-unmodified-zio-bell'
        provenance['bellStartSeconds'] = ANCHORS[prefix]
        provenance['audioFile'] = str(audio)
        provenance['audioSha256'] = hashlib.sha256(audio.read_bytes()).hexdigest()
        provenance['reusedFiles'] = [r for r in provenance['reusedFiles']
                                     if not Path(r['path']).name.endswith('-audio.wav')]
        provenance['reusedFiles'].append({'path': str(audio),
                                          'sha256': provenance['audioSha256']})
        marker.write_text(json.dumps(provenance, indent=2), encoding='utf-8')
    (DEST / 'remux-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mix-only', action='store_true')
    args = parser.parse_args()
    mix()
    if not args.mix_only:
        remux()
