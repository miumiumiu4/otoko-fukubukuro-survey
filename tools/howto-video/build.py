# 収録した画面に、シーンごとの字幕（とあれば音声）を重ねて1本にする
# 使い方: python3 build.py [音声フォルダ]  音声フォルダに <scene>.mp3 があれば、その長さに合わせて画面を伸ばし音声を入れる
import json, subprocess, sys, os, glob
here = os.path.dirname(os.path.abspath(__file__))
os.chdir(here)
scenes = json.load(open('scenes.json')); nar = json.load(open('narration.json', encoding='utf8'))
raw = glob.glob('raw/*.webm')[0]
audio_dir = sys.argv[1] if len(sys.argv) > 1 else None
font = subprocess.check_output(['fc-match', '-f', '%{file}', 'IPAGothic']).decode()
def dur(f): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]))
def wrap(t, n=18):
    lines, cur = [], ''
    for ch in t:
        cur += ch
        if len(cur) >= n and ch in '、。」' or len(cur) >= n + 4: lines.append(cur); cur = ''
    if cur: lines.append(cur)
    return '\n'.join(lines)
os.makedirs('parts', exist_ok=True)
parts = []
for i in range(len(scenes) - 1):
    sid, start, end = scenes[i]['id'], scenes[i]['t'], scenes[i + 1]['t']
    length = end - start
    text = nar[sid]
    a = os.path.join(audio_dir, sid + '.mp3') if audio_dir else None
    target = max(length, (dur(a) + 0.6) if a and os.path.exists(a) else len(text) / 7.0 + 0.8)
    open(f'parts/{sid}.txt', 'w', encoding='utf8').write(wrap(text))
    vf = (f"tpad=stop_mode=clone:stop_duration={max(0, target - length):.2f},"
          f"drawbox=x=0:y=ih-330:w=iw:h=330:color=black@0.78:t=fill,"
          f"drawtext=fontfile={font}:textfile=parts/{sid}.txt:fontcolor=0xf2e3b5:fontsize=34:line_spacing=14:x=(w-text_w)/2:y=h-300,"
          f"drawtext=fontfile={font}:text='※画面のデータはサンプルです':fontcolor=0x9a958a:fontsize=22:x=w-text_w-24:y=h-44")
    cmd = ['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.2f}', '-t', f'{length:.2f}', '-i', raw]
    if a and os.path.exists(a):
        cmd += ['-i', a, '-filter_complex', f'[0:v]{vf}[v];[1:a]adelay=300|300,apad[a]', '-map', '[v]', '-map', '[a]', '-t', f'{target:.2f}']
    else:
        cmd += ['-f', 'lavfi', '-t', f'{target:.2f}', '-i', 'anullsrc=r=44100:cl=stereo', '-filter_complex', f'[0:v]{vf}[v]', '-map', '[v]', '-map', '1:a']
    cmd += ['-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-c:a', 'aac', '-ar', '44100', '-ac', '2', f'parts/{i}.mp4']
    subprocess.check_call(cmd); parts.append(f'parts/{i}.mp4')
open('parts/list.txt', 'w').write(''.join(f"file '{os.path.basename(p)}'\n" for p in parts))
out = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else 'out.mp4')
subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'parts/list.txt', '-c', 'copy', '-movflags', '+faststart', out])
print(out, round(dur(out), 1), 'sec')
