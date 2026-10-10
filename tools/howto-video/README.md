# 使い方動画の作り方

1. 作業フォルダに `site/`（index.html, admin.html, assets/）と、`config.js`（API_URL は `https://script.google.com/macros/s/TEST/exec`）を用意する
2. `node rec.js <作業フォルダ>` … GAS をモックしてサンプルデータで画面を収録（`video/raw/*.webm` と `video/scenes.json`）
3. `video/` に `build.py` と `narration.json` を置き、`python3 build.py [音声フォルダ] [出力.mp4]`
   - 音声フォルダに `<シーン名>.mp3`（login, surveys, responses, people, dashboard, csv, logout）があれば、その長さに合わせて画面を伸ばして声を入れる
   - 無ければ字幕だけの版になる

声は ElevenLabs（https://elevenlabs.io/app/home）で、公嗣さん本人の声のボイスを使って作る。
