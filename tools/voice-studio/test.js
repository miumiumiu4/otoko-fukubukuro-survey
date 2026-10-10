// ナレーション工房の動作を、ドライブと ElevenLabs をモックして確かめる。実行: node tools/voice-studio/test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let idc = 0;
function folder(name) {
  const f = { id: 'F' + (++idc), name, folders: [], files: [],
    getId: () => f.id, getUrl: () => 'url/' + f.id,
    getFoldersByName: n => iter(f.folders.filter(x => x.name === n)),
    getFilesByName: n => iter(f.files.filter(x => x.name === n)),
    getFiles: () => iter(f.files.slice()),
    createFolder: n => { const c = folder(n); f.folders.push(c); all[c.id] = c; return c; },
    createFile: (a, b) => { const x = typeof a === 'string' ? file(a, b) : file(a.name, a.data); x.parent = f; f.files.push(x); return x; } };
  return f;
}
function file(name, data) {
  const x = { name, data, getName: () => x.name, getBlob: () => ({ getDataAsString: () => x.data }),
    moveTo: d => { x.parent.files.splice(x.parent.files.indexOf(x), 1); x.parent = d; d.files.push(x); } };
  return x;
}
function iter(a) { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; }
const all = {}; const root = folder('root'); all[root.id] = root;
const props = {}; const sent = [];
const ctx = {
  console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  DriveApp: { getRootFolder: () => root, getFolderById: id => { if (!all[id]) throw new Error('no'); return all[id]; } },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  UrlFetchApp: { fetch: (url, opt) => {
    if (url.endsWith('/voices')) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ voices: [{ name: '他人', voice_id: 'x' }, { name: 'サトシ先生（インスタント）', voice_id: 'V1' }] }) };
    sent.push({ url, body: JSON.parse(opt.payload), key: opt.headers['xi-api-key'] });
    return { getResponseCode: () => 200, getBlob: () => ({ setName: n => ({ name: n, data: 'mp3' }) }) };
  } }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/Code.gs', 'utf8'), ctx);
props.ELEVENLABS_API_KEY = 'k';
ctx.setup();
const studio = root.folders.find(f => f.name === 'ナレーション工房');
const inbox = studio.folders.find(f => f.name === '依頼');
inbox.createFile('howto.json', JSON.stringify({ job: 'howto', pronunciations: { '入山': 'いりやま' },
  lines: [{ id: 'login', text: '入山さん、こんにちは' }, { id: 'csv', text: 'CSVです' }] }));
ctx.processRequests();
const out = studio.folders.find(f => f.name === 'howto');
assert.deepStrictEqual(out.files.map(f => f.name), ['login.mp3', 'csv.mp3', 'result.json']);
assert.strictEqual(sent[0].body.text, 'いりやまさん、こんにちは');
assert.ok(sent[0].url.includes('/text-to-speech/V1'));
assert.strictEqual(sent[0].body.model_id, 'eleven_multilingual_v2');
assert.strictEqual(inbox.files.length, 0);
// 声が無いとエラーファイルを残す
inbox.createFile('bad.json', JSON.stringify({ job: 'bad', voice: '存在しない', lines: [{ id: 'a', text: 'x' }] }));
ctx.processRequests();
const bad = studio.folders.find(f => f.name === 'bad');
assert.ok(bad.files[0].name.startsWith('error_') && bad.files[0].data.includes('候補'));
console.log('OK: voice studio tests passed');
