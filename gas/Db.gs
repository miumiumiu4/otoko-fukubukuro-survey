/**
 * データ層：スプレッドシートを「縦持ち」のテーブルとして扱う。
 * アンケートが増えても列は増えない。1行 = 1レコード。
 */

var SCHEMA = {
  Surveys: ['survey_id', 'title', 'description', 'community', 'status', 'created_at', 'updated_at'],
  // options は形式ごとの細かい設定（その他の欄、目盛りの範囲と両端の言葉）を JSON で持つ。後から足した列なので最後に置く
  Questions: ['survey_id', 'question_id', 'order', 'text', 'help_text', 'type', 'required', 'choices', 'meaning_label', 'options'],
  Respondents: ['respondent_id', 'email', 'name', 'first_seen', 'last_seen', 'survey_count'],
  Responses: ['response_id', 'survey_id', 'respondent_id', 'submitted_at'],
  Answers: ['response_id', 'question_id', 'meaning_label', 'answer'],
  AI_Analysis: ['response_id', 'summary', 'before_state', 'after_state', 'pain_tags', 'change_tags',
    'outcome_numbers', 'recommend_target', 'best_quote', 'analyzed_at'],
  Tags: ['tag', 'category', 'description']
};

/** 今後どのアンケートでも共通で使う「意味ラベル」 */
var MEANING_LABELS = {
  email: 'メールアドレス',
  name: '名前',
  pain: '参加前の悩み',
  change: '変化',
  insight: '効いた体験・考え方',
  before_after: 'ビフォーアフター',
  outcome: '成果・数字',
  recommend: 'どんな人に勧めたいか',
  quote: '紹介文に使える一言',
  satisfaction: '満足度',
  request: '要望・改善点',
  profile: '属性（年代・職業など）',
  other: 'その他'
};

// Google フォームに合わせた形式。choice=ラジオボタン、checkbox=チェックボックス（複数回答）、dropdown=プルダウン、scale=均等目盛
var QUESTION_TYPES = ['text', 'textarea', 'choice', 'checkbox', 'dropdown', 'scale', 'date', 'time', 'email', 'name'];
var OTHER_PREFIX = 'その他: ';
var MULTI_SEPARATOR = ' | ';

/** 形式ごとの設定を、使える値だけに整える */
function normalizeOptions_(type, o) {
  o = o || {};
  var out = {};
  if (type === 'choice' || type === 'checkbox') out.allow_other = !!o.allow_other;
  if (type === 'scale') {
    var min = Number(o.scale_min) === 0 ? 0 : 1;
    var max = Math.round(Number(o.scale_max));
    if (!(max >= 2 && max <= 10)) max = 10;
    out.scale_min = min; out.scale_max = max;
    out.label_min = String(o.label_min || '').slice(0, 30);
    out.label_max = String(o.label_max || '').slice(0, 30);
  }
  return out;
}

function parseOptions_(type, s) {
  var o = {};
  if (s && typeof s === 'object') o = s;
  else { try { o = JSON.parse(s || '{}'); } catch (e) { o = {}; } }
  return normalizeOptions_(type, o);
}

/** 見出し行が古い（列が足りない）シートを、今の SCHEMA に合わせる */
function ensureHeaders_() {
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = db_().getSheetByName(name);
    if (!sh) return;
    var header = SCHEMA[name];
    var cur = sh.getRange(1, 1, 1, header.length).getValues()[0];
    if (cur.join('|') !== header.join('|')) sh.getRange(1, 1, 1, header.length).setValues([header]);
  });
}
var SURVEY_STATUSES = ['draft', 'published', 'closed'];
var TAG_CATEGORIES = ['pain', 'change', 'outcome'];

var _ssCache = null;

function db_() {
  if (_ssCache) return _ssCache;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID が未設定です。GASエディタで setup を実行してください。');
  _ssCache = SpreadsheetApp.openById(id);
  return _ssCache;
}

function sheet_(name) {
  var sh = db_().getSheetByName(name);
  if (!sh) throw new Error('シートがありません: ' + name);
  return sh;
}

/** シート全体をオブジェクト配列で返す（_row に実際の行番号を付ける） */
function readAll_(name) {
  var values = sheet_(name).getDataRange().getValues();
  var header = SCHEMA[name];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.join('') === '') continue;
    var obj = { _row: i + 1 };
    for (var c = 0; c < header.length; c++) obj[header[c]] = normalize_(row[c]);
    out.push(obj);
  }
  return out;
}

function normalize_(v) {
  if (v instanceof Date) return v.toISOString();
  return v === null || v === undefined ? '' : v;
}

function toRow_(name, obj) {
  return SCHEMA[name].map(function (k) {
    var v = obj[k];
    if (v === undefined || v === null) return '';
    // 数式インジェクション対策：先頭が = + - @ の文字列はそのまま文字として保存
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
    return v;
  });
}

function append_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var rows = objs.map(function (o) { return toRow_(name, o); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, SCHEMA[name].length).setValues(rows);
}

function updateRow_(name, rowNumber, obj) {
  sheet_(name).getRange(rowNumber, 1, 1, SCHEMA[name].length).setValues([toRow_(name, obj)]);
}

/** 条件に合う行を消して、残りを書き直す（行数が数千程度までを想定） */
function deleteWhere_(name, predicate) {
  var sh = sheet_(name);
  var all = readAll_(name);
  var keep = all.filter(function (o) { return !predicate(o); });
  if (keep.length === all.length) return 0;
  var width = SCHEMA[name].length;
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
  if (keep.length) {
    sh.getRange(2, 1, keep.length, width).setValues(keep.map(function (o) { return toRow_(name, o); }));
  }
  return all.length - keep.length;
}

function nowIso_() {
  return new Date().toISOString();
}

function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

/** respondent_id = メールを小文字化して SHA-256 したもの（先頭32桁） */
function respondentIdFor_(email) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    String(email).trim().toLowerCase(), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 32);
}

function splitList_(s) {
  if (Array.isArray(s)) return s;
  return String(s || '').split(/\s*[|｜\n]\s*/).filter(function (x) { return x !== ''; });
}
