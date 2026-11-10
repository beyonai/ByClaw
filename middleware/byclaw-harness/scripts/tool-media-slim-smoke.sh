#!/usr/bin/env bash
# Actual offline Media acceptance: browser preview, animated video and audible audio.
set -Eeuo pipefail
work="$(mktemp -d /tmp/byclaw-media-smoke.XXXXXX)"
cleanup() {
  local status=$?
  if ((status != 0)); then
    for log in check.json check.stderr preview.stderr render.log chromium.stderr; do
      if [[ -s "$work/$log" ]]; then printf '%s\n' "Media smoke diagnostic: $log"; tail -30 "$work/$log"; fi
    done
  fi
  (cd "$work" && hyperframes preview --stop >/dev/null 2>&1) || true
  if [[ "${BYCLAW_MEDIA_SMOKE_KEEP:-0}" == 1 ]]; then
    printf 'Media smoke artifacts: %s\n' "$work"
  else
    rm -rf "$work"
  fi
}
trap cleanup EXIT
export DO_NOT_TRACK=1
export HYPERFRAMES_TELEMETRY_DISABLED=1
for command in hyperframes ffmpeg ffprobe chromium node npm python3 timeout; do command -v "$command" >/dev/null; done
export BYCLAW_MEDIA_SMOKE_CHROMIUM="$(command -v chromium)"
mkdir -p "$work/assets"
cp "$(npm root -g)/gsap/dist/gsap.min.js" "$work/assets/gsap.min.js"
ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:duration=1:sample_rate=48000' -c:a pcm_s16le "$work/assets/tone.wav"
cat >"$work/index.html" <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ByClaw Media smoke</title>
<script src="assets/gsap.min.js"></script><style>
html,body{margin:0;width:320px;height:180px;background:#081420;color:#fff;font-family:sans-serif}
#root{position:relative;width:320px;height:180px;overflow:hidden}
#scene{position:absolute;inset:0;background:#081420}
#box{position:absolute;left:24px;top:60px;width:48px;height:48px;background:#00dcff}
#label{position:absolute;left:24px;top:16px;font-size:18px;margin:0}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-width="320" data-height="180" data-duration="1" data-fps="30">
<section id="scene" class="clip" data-start="0" data-duration="1" data-track-index="1"><h1 id="label">ByClaw Media smoke</h1><div id="box"></div></section>
<audio id="tone" src="assets/tone.wav" class="clip" data-start="0" data-duration="1" data-track-index="2"></audio>
</div><script>
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
tl.fromTo('#box',{x:0},{x:200,duration:0.99,ease:'none'},0);
window.__timelines.main=tl;
document.documentElement.setAttribute('data-smoke-ready','true');
</script></body></html>
HTML
cd "$work"
timeout 90 hyperframes check --json >check.json 2>check.stderr
# Verify a real headless browser executes the local composition, including GSAP.
NODE_PATH="$(npm root -g)" timeout 30 node <<'JS'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.BYCLAW_MEDIA_SMOKE_CHROMIUM, headless:true, args:['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files']});
  try {
    const page=await browser.newPage({viewport:{width:320,height:180}});
    await page.goto('file://'+process.cwd()+'/index.html');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-smoke-ready') === 'true');
    await page.screenshot({path:'preview.png'});
    console.log('headless Chromium executed GSAP composition and captured preview');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
JS
# Studio preview must also start and serve an HTTP page in this image.
timeout 45 hyperframes preview --background --no-open --port 31893 --json >preview.json 2>preview.stderr
python3 - <<'PY'
import urllib.request
with urllib.request.urlopen('http://127.0.0.1:31893/', timeout=10) as response:
    assert response.status == 200
    assert len(response.read()) > 100
print('headless Chromium composition and HyperFrames preview HTTP passed')
PY
timeout 180 hyperframes render --quality draft --fps 30 --no-browser-gpu --strict -o "$work/render.mp4" >render.log 2>&1
test -s render.mp4
ffprobe -v error -show_format -show_streams -of json render.mp4 >probe.json
ffmpeg -hide_banner -loglevel error -ss 0.1 -i render.mp4 -frames:v 1 -f rawvideo -pix_fmt rgb24 frame-early.rgb
ffmpeg -hide_banner -loglevel error -ss 0.8 -i render.mp4 -frames:v 1 -f rawvideo -pix_fmt rgb24 frame-late.rgb
ffmpeg -hide_banner -loglevel error -i render.mp4 -vn -f s16le -ac 1 -ar 48000 audio.pcm
python3 - <<'PY'
import array, hashlib, json, math
from pathlib import Path
probe = json.loads(Path('probe.json').read_text())
video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
audio = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
assert video['codec_name'] == 'h264', video['codec_name']
assert audio['codec_name'] == 'aac', audio['codec_name']
assert (video['width'], video['height']) == (320, 180)
assert 0.9 <= float(probe['format']['duration']) <= 1.2
assert int(video['nb_frames']) == 30
frames = [Path(p).read_bytes() for p in ('frame-early.rgb', 'frame-late.rgb')]
assert all(len(f) == 320 * 180 * 3 for f in frames)
assert hashlib.sha256(frames[0]).digest() != hashlib.sha256(frames[1]).digest(), 'animation rendered static'
for frame in frames:
    cyan = sum(1 for i in range(0, len(frame), 3) if frame[i] < 60 and frame[i+1] > 130 and frame[i+2] > 150)
    assert cyan > 1000, 'rendered moving square missing'
samples = array.array('h', Path('audio.pcm').read_bytes())
rms = math.sqrt(sum(v*v for v in samples) / len(samples))
assert len(samples) >= 45000 and rms > 100, 'rendered audio silent or truncated'
print(json.dumps({'result':'Media render passed','video':'h264','audio':'aac','duration':probe['format']['duration'],'frames':video['nb_frames'],'audioRms':round(rms, 1)}))
PY
printf 'Media smoke passed: browser preview, 1s animated HyperFrames render, decoded video motion and audible audio.\n'
