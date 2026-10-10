// GAS の実行環境（スプレッドシート・メール・Claude API など）を Node 上で真似するモック。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function createGas() {
  function makeSheet(name) {
    const data = [];
    const sh = {
      name,
      getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
      getLastRow: () => data.length,
      getRange: (r, c, nr = 1, nc = 1) => ({
        setValues(vals) { vals.forEach((row, i) => { data[r - 1 + i] = data[r - 1 + i] || []; row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; }); }); return this; },
        clearContent() { for (let i = 0; i < nr; i++) if (data[r - 1 + i]) data[r - 1 + i] = data[r - 1 + i].map(() => ''); return this; },
        setFontWeight() { return this; }
      }),
      setFrozenRows() {},
      _data: data
    };
    return sh;
  }
  const sheets = {};
  const ss = {
    getId: () => 'SS1', getUrl: () => 'https://sheet',
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets), deleteSheet() {}
  };
  const props = {};
  const mails = [];
  let claudeCalls = [];
  const ctx = {
    console,
    SpreadsheetApp: { openById: () => ss, create: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(), sleep() {},
      computeDigest: (_a, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: s => ({ s, setMimeType() { return JSON.parse(s); } }), MimeType: { JSON: 'json' } },
    MailApp: { sendEmail: m => mails.push(m) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) },
    UrlFetchApp: {
      fetch: (url, opt) => {
        const body = JSON.parse(opt.payload);
        claudeCalls.push({ url, opt, body });
        const out = { summary: '自信がなかったが行動できるようになった', before_state: '自信がない', after_state: '毎朝走る',
          pain_tags: ['自信がない'], change_tags: ['行動力が上がった', '朝型になった'], outcome_numbers: ['体重 -5kg'],
          recommend_target: ['一歩踏み出せない30代'], best_quote: '人生が変わった3日間でした',
          new_tags: [{ tag: '朝型になった', category: 'change', description: '早起きが習慣化' }] };
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(out) }] }) };
      }
    }
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'gas');
  for (const f of ['Db.gs', 'Api.gs', 'Ai.gs', 'Mail.gs', 'Setup.gs']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  const post = body => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return { ctx, post, props, sheets, mails, get claudeCalls() { return claudeCalls; } };
}

module.exports = { createGas };
