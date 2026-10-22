from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import subprocess, json, hashlib, os

root = Path('F:/VirtuGene-Mobile')
out = root / os.environ.get('VG_CALL_MOTION_OUTPUT', '.tmp-preview/ui-overhaul-20261015/call-motion-v2')
ffmpeg = Path('C:/Users/34568/AppData/Local/ms-playwright/ffmpeg-1011/ffmpeg-win64.exe')
recording = json.loads((out / 'recording.json').read_text(encoding='utf-8'))
for row in recording['recordings']:
    frames = out / f"{row['theme']}-frames"
    frames.mkdir(exist_ok=True)
    command = [str(ffmpeg), '-y', '-ss', f"{row['startOffsetMs']/1000:.3f}", '-i', str(out / f"{row['theme']}.webm"), '-t', '7.5', '-an', '-r', '15', '-fps_mode', 'cfr', '-vf', 'scale=390:844:flags=lanczos', str(frames / 'frame-%05d.png')]
    result = subprocess.run(command, capture_output=True, text=True)
    (out / f"decode-{row['theme']}.log").write_text(result.stderr, encoding='utf-8')
    result.check_returncode()

dark = sorted((out / 'dark-frames').glob('frame-*.png'))
light = sorted((out / 'light-frames').glob('frame-*.png'))
count = min(len(dark), len(light))
assert count >= 90, count
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 13)
frames = []
for index in range(count):
    frame = Image.new('RGB', (782, 872), '#0d0b14')
    with Image.open(dark[index]) as image:
        frame.paste(image.convert('RGB'), (0, 28))
    with Image.open(light[index]) as image:
        frame.paste(image.convert('RGB'), (392, 28))
    draw = ImageDraw.Draw(frame)
    draw.text((391, 13), '实际界面 · 模拟通话阶段 · 无录音或模型调用', font=font, fill='#e4e1f0', anchor='mm')
    frames.append(frame)

samples = Image.new('RGB', (196 * 4, 218 * 3))
for i in range(12):
    thumbnail = frames[round(i * (count - 1) / 11)].resize((196, 218), Image.Resampling.LANCZOS)
    samples.paste(thumbnail, ((i % 4) * 196, (i // 4) * 218))
palette = samples.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
encoded = [frame.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG) for frame in frames]
durations = [[70, 60, 70][i % 3] for i in range(count)]
target = out / 'VirtuGene-call-dark-light.gif'
encoded[0].save(target, save_all=True, append_images=encoded[1:], duration=durations, loop=0, optimize=False, disposal=1)
webp = out / 'VirtuGene-call-dark-light.webp'
frames[0].save(webp, save_all=True, append_images=frames[1:], duration=durations, loop=0, quality=88, method=4)
small = [frame.resize((626, 698), Image.Resampling.LANCZOS).quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
small_target = out / 'VirtuGene-call-preview.gif'
small[0].save(small_target, save_all=True, append_images=small[1:], duration=durations, loop=0, optimize=False, disposal=1)
with Image.open(target) as gif:
    hashes = set()
    total = 0
    for i in range(gif.n_frames):
        gif.seek(i)
        total += gif.info.get('duration', 0)
        hashes.add(hashlib.sha256(gif.convert('RGB').tobytes()).hexdigest())
    assert gif.n_frames > 1 and len(hashes) > 20
    for label, index in [('first', 0), ('middle', gif.n_frames//2), ('last', gif.n_frames-1)]:
        gif.seek(index)
        gif.convert('RGB').save(out / f'gif-{label}.png')
    evidence = dict(file=str(target), frames=gif.n_frames, durationMs=total, uniqueFrames=len(hashes), loop=gif.info.get('loop'), bytes=target.stat().st_size, size=gif.size, animatedWebp=str(webp),webpBytes=webp.stat().st_size,compactGif=str(small_target),compactGifBytes=small_target.stat().st_size,scope='Actual component capture. Sequential dark/light recordings composited; synthetic call states, no real audio or model.')
(out / 'gif-result.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(evidence, ensure_ascii=False))
