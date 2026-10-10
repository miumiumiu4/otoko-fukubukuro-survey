/**
 * ナレーション工房：Google ドライブに置かれた「ナレーション依頼」を見て、
 * ElevenLabs で公嗣さんの声の MP3 を作り、同じドライブに保存する。
 *
 * 流れ
 *   1. Claude が「ナレーション工房/依頼」フォルダに <ジョブ名>.json を置く
 *   2. 5分ごとのトリガーで processRequests が動き、1行ずつ音声を作る
 *   3. 「ナレーション工房/<ジョブ名>/<行のid>.mp3」と result.json を保存し、依頼ファイルを「済み」へ移す
 *
 * 依頼ファイルの形
 *   { "job": "irimaya-howto",
 *     "lines": [ { "id": "login", "text": "入山さん、…" }, … ],
 *     "pronunciations": { "入山": "いりやま" },   // 任意。音声にするときだけ置き換える
 *     "voice": "サトシ先生（インスタント）" }      // 任意。省略時はスクリプトプロパティ VOICE_NAME
 *
 * スクリプトプロパティ
 *   ELEVENLABS_API_KEY … ElevenLabs の API キー（本人が設定。コードには書かない）
 *   VOICE_NAME         … 既定の声の名前（setup で「サトシ先生（インスタント）」を入れる）
 *   MODEL_ID           … 既定 eleven_multilingual_v2
 *   ROOT_FOLDER_ID     … setup が作る「ナレーション工房」フォルダ
 */

var API = 'https://api.elevenlabs.io/v1';

function setup() {
  var props = PropertiesService.getScriptProperties();
  var root = folderById_(props.getProperty('ROOT_FOLDER_ID')) || findOrCreate_(DriveApp.getRootFolder(), 'ナレーション工房');
  props.setProperty('ROOT_FOLDER_ID', root.getId());
  findOrCreate_(root, '依頼');
  findOrCreate_(root, '済み');
  if (!props.getProperty('VOICE_NAME')) props.setProperty('VOICE_NAME', 'サトシ先生（インスタント）');
  if (!props.getProperty('MODEL_ID')) props.setProperty('MODEL_ID', 'eleven_multilingual_v2');

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processRequests') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processRequests').timeBased().everyMinutes(5).create();

  console.log('フォルダ: ' + root.getUrl());
  if (!props.getProperty('ELEVENLABS_API_KEY')) {
    console.log('スクリプト プロパティに ELEVENLABS_API_KEY を追加してください。');
  } else {
    console.log('声の確認: ' + resolveVoiceId_(props.getProperty('VOICE_NAME')));
  }
}

/** 5分ごとのトリガーから呼ばれる */
function processRequests() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // 前回の処理がまだ動いている
  try {
    var props = PropertiesService.getScriptProperties();
    var root = folderById_(props.getProperty('ROOT_FOLDER_ID'));
    if (!root) throw new Error('setup を先に実行してください。');
    var inbox = findOrCreate_(root, '依頼'), done = findOrCreate_(root, '済み');
    var files = inbox.getFiles();
    var start = Date.now();
    while (files.hasNext() && Date.now() - start < 240000) {
      var f = files.next();
      if (!/\.json$/i.test(f.getName())) continue;
      handleRequest_(f, root, done, start);
    }
  } finally {
    lock.releaseLock();
  }
}

function handleRequest_(file, root, done, start) {
  var props = PropertiesService.getScriptProperties();
  var req, out, result = { started_at: new Date().toISOString(), files: [], errors: [] };
  try {
    req = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    var job = String(req.job || file.getName().replace(/\.json$/i, '')).replace(/[\\/:*?"<>|]/g, '_');
    out = findOrCreate_(root, job);
    var key = props.getProperty('ELEVENLABS_API_KEY');
    if (!key) throw new Error('ELEVENLABS_API_KEY が未設定です。');
    var voiceName = req.voice || props.getProperty('VOICE_NAME');
    var voiceId = resolveVoiceId_(voiceName);
    var model = req.model || props.getProperty('MODEL_ID') || 'eleven_multilingual_v2';
    result.job = job; result.voice = voiceName; result.model = model;

    (req.lines || []).forEach(function (line) {
      var name = String(line.id) + '.mp3';
      if (out.getFilesByName(name).hasNext()) { result.files.push(name); return; } // 途中で止まった続きから
      if (Date.now() - start > 300000) throw new Error('時間切れ。次の回で続きを作ります。');
      var text = applyPronunciations_(String(line.text), req.pronunciations || {});
      var res = UrlFetchApp.fetch(API + '/text-to-speech/' + encodeURIComponent(voiceId) + '?output_format=mp3_44100_128', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'xi-api-key': key, accept: 'audio/mpeg' },
        payload: JSON.stringify({ text: text, model_id: model })
      });
      if (res.getResponseCode() !== 200) {
        throw new Error(line.id + ': ElevenLabs エラー ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
      }
      out.createFile(res.getBlob().setName(name));
      result.files.push(name);
    });
    result.finished_at = new Date().toISOString();
    out.createFile('result.json', JSON.stringify(result, null, 1), 'application/json');
    file.moveTo(done);
  } catch (err) {
    if (/時間切れ/.test(err.message)) return; // 依頼はそのまま残し、次の回で続ける
    result.errors.push(String(err.message || err));
    (out || root).createFile('error_' + file.getName(), JSON.stringify(result, null, 1), 'application/json');
    file.moveTo(done);
  }
}

function applyPronunciations_(text, dict) {
  Object.keys(dict).forEach(function (k) { text = text.split(k).join(dict[k]); });
  return text;
}

/** 声の名前から voice_id を探す（自分の声を優先） */
function resolveVoiceId_(name) {
  var key = PropertiesService.getScriptProperties().getProperty('ELEVENLABS_API_KEY');
  var res = UrlFetchApp.fetch(API + '/voices', { headers: { 'xi-api-key': key }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('声の一覧を取れません: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  var voices = JSON.parse(res.getContentText()).voices || [];
  var hit = voices.filter(function (v) { return v.name === name; })[0];
  if (!hit) {
    throw new Error('声「' + name + '」が見つかりません。候補: ' + voices.map(function (v) { return v.name; }).join(' / '));
  }
  return hit.voice_id;
}

function folderById_(id) {
  if (!id) return null;
  try { return DriveApp.getFolderById(id); } catch (e) { return null; }
}

function findOrCreate_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
