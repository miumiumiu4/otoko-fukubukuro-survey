# ナレーション工房（公嗣さんの声の自動ナレーション）

Google ドライブに依頼ファイルを置くと、5分以内に ElevenLabs で公嗣さんの声の MP3 ができ、ドライブに保存される。
Claude は Google Drive コネクタで依頼を置き、できた MP3 を取り出して動画に使う（Claude の作業環境から ElevenLabs や GAS へは直接つながらないため、ドライブを受け渡し場所にしている）。

## フォルダ
- `ナレーション工房/依頼/` … ここに `<ジョブ名>.json` を置く
- `ナレーション工房/<ジョブ名>/` … `<id>.mp3` と `result.json`（失敗時は `error_<ジョブ名>.json`）
- `ナレーション工房/済み/` … 処理が終わった依頼

## 依頼ファイル
```json
{
  "job": "irimaya-howto-v1",
  "lines": [{ "id": "login", "text": "入山さん、送ったリンクを…" }],
  "pronunciations": { "入山": "いりやま" }
}
```
- `pronunciations` は音声にするときだけ置き換える（字幕は元の漢字のまま使える）
- `voice` を書けば声を変えられる（既定はスクリプトプロパティ `VOICE_NAME`＝「サトシ先生（インスタント）」）
- 同じジョブ名で作り直すときは、ジョブ名を変える（例：`-v2`）。既にある mp3 は作り直さない

## 設置（初回だけ）
1. https://script.new で新しいプロジェクトを作り、名前を「ナレーション工房」にする
2. `Code.gs` の中身を貼り付けて保存
3. 関数 `setup` を実行して権限を許可（ドライブ・外部への接続・トリガー）
4. スクリプト プロパティに `ELEVENLABS_API_KEY`（ElevenLabs の API キー。権限は Text to Speech と Voices の読み取り）を追加
5. もう一度 `setup` を実行し、ログに「声の確認: …」と出れば完了

## テスト
`node tools/voice-studio/test.js`
