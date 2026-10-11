// 漢の福袋 アンケート API（gas/ の全ファイルを結合したもの。編集は gas/ 側で行い scripts/bundle.sh で再生成）

// ===== Db.gs =====
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

// ===== Keys.gs =====
/**
 * 鍵（ログインキー）と権限。
 * - owner  : すべての操作＋鍵の発行・停止ができる。スクリプトプロパティ ADMIN_KEY（元の持ち主。管理画面からは
 *            停止できない）と、「鍵」タブで発行したオーナーの鍵がある
 * - editor : アンケートの作成・編集・公開/停止、AI分析、タグ編集ができる（鍵の管理はできない）
 * - viewer : 閲覧専用。回答・人別・AI分析の結果・タグを見るだけ
 * owner 以外の鍵は管理画面の「鍵」タブで発行する。値は保存せず、SHA-256 のハッシュだけを
 * スクリプトプロパティ KEY_<id> に JSON で持つ（発行時に一度だけ画面に表示）。
 */

var ROLES = { owner: 'オーナー', editor: '編集できる', viewer: '閲覧専用' };
var ROLE_RANK = { viewer: 1, editor: 2, owner: 3 };
var KEY_PREFIX = 'KEY_';

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** 鍵を確かめて { id, name, role } を返す。違えば例外 */
function authenticate_(key) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  key = String(key || '');
  if (key && all.ADMIN_KEY && safeEqual_(key, all.ADMIN_KEY)) {
    return { id: 'owner', name: 'オーナー', role: 'owner' };
  }
  if (key) {
    var hash = sha256Hex_(key);
    for (var prop in all) {
      if (prop.indexOf(KEY_PREFIX) !== 0) continue;
      var rec;
      try { rec = JSON.parse(all[prop]); } catch (e) { continue; }
      if (!rec.disabled && safeEqual_(hash, rec.hash)) {
        // 最終利用日時は1時間に1回だけ書き込む（毎回書くと遅くなるため）
        if (!rec.last_used || Date.now() - new Date(rec.last_used).getTime() > 3600000) {
          rec.last_used = nowIso_();
          props.setProperty(prop, JSON.stringify(rec));
        }
        return { id: prop.slice(KEY_PREFIX.length), name: rec.name, role: rec.role };
      }
    }
  }
  if (!all.ADMIN_KEY) throw new Error('ADMIN_KEY が未設定です。');
  Utilities.sleep(800); // 総当たり対策のささやかな遅延
  throw new Error('管理者キーが違います。');
}

function requireRole_(user, role) {
  if (ROLE_RANK[user.role] < ROLE_RANK[role]) {
    throw new Error('この操作をする権限がありません（' + ROLES[user.role] + 'の鍵です）。');
  }
}

function apiListKeys_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all).filter(function (k) { return k.indexOf(KEY_PREFIX) === 0; }).map(function (k) {
    var rec = {};
    try { rec = JSON.parse(all[k]); } catch (e) {}
    return { id: k.slice(KEY_PREFIX.length), name: rec.name || '', role: rec.role || '',
      created_at: rec.created_at || '', last_used: rec.last_used || '', disabled: !!rec.disabled };
  }).sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
}

function apiCreateKey_(p) {
  var name = String(p.name || '').trim().slice(0, 30);
  var role = String(p.role || '');
  if (!name) throw new Error('名前を入力してください。');
  if (!ROLES[role]) throw new Error('権限を選んでください。');
  if (apiListKeys_().some(function (k) { return k.name === name && !k.disabled; })) {
    throw new Error('「' + name + '」の鍵はすでにあります。先に停止してから作り直してください。');
  }
  var key = role.charAt(0) + '-' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  var id = newId_('k');
  PropertiesService.getScriptProperties().setProperty(KEY_PREFIX + id, JSON.stringify({
    name: name, role: role, hash: sha256Hex_(key), created_at: nowIso_(), last_used: '', disabled: false
  }));
  return { id: id, name: name, role: role, key: key };
}

function apiRevokeKey_(p) {
  var prop = KEY_PREFIX + String(p.id || '');
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(prop)) throw new Error('鍵が見つかりません。');
  props.deleteProperty(prop);
  return { id: p.id, revoked: true };
}

// ===== Api.gs =====
/**
 * ウェブアプリの入口。GitHub Pages から fetch(POST, Content-Type: text/plain) で呼ばれる。
 * body = JSON 文字列 { action, ...params, adminKey? }
 * 返り値 = { ok: true, data } または { ok: false, error }
 */

var PUBLIC_ACTIONS = {
  getSurvey: apiGetSurvey_,
  submit: apiSubmit_
};

// 管理画面の操作と、必要な権限（viewer < editor < owner）
var ADMIN_ACTIONS = {
  ping: ['viewer', function (p, user) {
    return { labels: MEANING_LABELS, types: QUESTION_TYPES, user: user, roles: ROLES };
  }],
  listSurveys: ['viewer', apiListSurveys_],
  getSurveyFull: ['viewer', apiGetSurveyFull_],
  listResponses: ['viewer', apiListResponses_],
  listRespondents: ['viewer', apiListRespondents_],
  dashboard: ['viewer', apiDashboard_],
  listTags: ['viewer', function () { return readAll_('Tags').map(strip_); }],
  saveSurvey: ['editor', apiSaveSurvey_],
  duplicateSurvey: ['editor', apiDuplicateSurvey_],
  setStatus: ['editor', apiSetStatus_],
  saveTags: ['editor', apiSaveTags_],
  importAnalysis: ['editor', function (p) { return apiImportAnalysis_(p); }],
  listKeys: ['owner', apiListKeys_],
  createKey: ['owner', apiCreateKey_],
  revokeKey: ['owner', apiRevokeKey_]
};

function doGet() {
  return json_({ ok: true, data: { service: '漢の福袋 アンケート API', time: nowIso_() } });
}

function doPost(e) {
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = String(p.action || '');
    if (PUBLIC_ACTIONS[action]) return json_({ ok: true, data: PUBLIC_ACTIONS[action](p) });
    if (ADMIN_ACTIONS[action]) {
      var user = authenticate_(p.adminKey);
      requireRole_(user, ADMIN_ACTIONS[action][0]);
      return json_({ ok: true, data: ADMIN_ACTIONS[action][1](p, user) });
    }
    throw new Error('不明な操作です: ' + action);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function strip_(o) {
  var c = {};
  for (var k in o) if (k !== '_row') c[k] = o[k];
  return c;
}

/* ---------- 公開：回答ページ ---------- */

function findSurvey_(surveyId) {
  var s = readAll_('Surveys').filter(function (x) { return x.survey_id === surveyId; })[0];
  if (!s) throw new Error('アンケートが見つかりません。');
  return s;
}

function questionsOf_(surveyId) {
  return readAll_('Questions')
    .filter(function (q) { return q.survey_id === surveyId; })
    .sort(function (a, b) { return Number(a.order) - Number(b.order); })
    .map(function (q) {
      var o = strip_(q);
      o.required = q.required === true || String(q.required).toUpperCase() === 'TRUE';
      o.choices = splitList_(q.choices);
      o.options = parseOptions_(q.type, q.options);
      return o;
    });
}

function apiGetSurvey_(p) {
  var s = findSurvey_(String(p.survey_id || ''));
  if (s.status !== 'published') {
    return { survey_id: s.survey_id, title: s.title, status: s.status, questions: [] };
  }
  return {
    survey_id: s.survey_id, title: s.title, description: s.description,
    community: s.community, status: s.status,
    questions: questionsOf_(s.survey_id).map(function (q) {
      return { question_id: q.question_id, text: q.text, help_text: q.help_text, type: q.type,
        required: q.required, choices: q.choices, options: q.options };
    })
  };
}

/** 選択肢にある答えか（「その他」を許す質問なら「その他: 〜」も可） */
function checkChoice_(q, v) {
  if (!q.choices.length || q.choices.indexOf(v) >= 0) return;
  if (q.options.allow_other && v.indexOf(OTHER_PREFIX) === 0 && v.length > OTHER_PREFIX.length) return;
  throw new Error('選択肢にない回答です：' + q.text);
}

function apiSubmit_(p) {
  var survey = findSurvey_(String(p.survey_id || ''));
  if (survey.status !== 'published') throw new Error('このアンケートは現在受付していません。');
  var questions = questionsOf_(survey.survey_id);
  var input = p.answers || {};
  var answers = [];
  var email = '', name = '';

  questions.forEach(function (q) {
    var v = input[q.question_id];
    if (q.type === 'checkbox') {
      var items = (Array.isArray(v) ? v : splitList_(v)).map(function (x) { return String(x).trim().slice(0, 500); })
        .filter(function (x) { return x !== ''; });
      items.forEach(function (x) { checkChoice_(q, x); });
      v = items.join(MULTI_SEPARATOR);
    }
    v = v === undefined || v === null ? '' : String(v).trim().slice(0, 5000);
    if (q.required && v === '') throw new Error('未回答の必須項目があります：' + q.text);
    if (v !== '' && (q.type === 'email' || q.meaning_label === 'email')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('メールアドレスの形式が正しくありません。');
      email = email || v.toLowerCase();
    }
    if (v !== '' && (q.type === 'choice' || q.type === 'dropdown')) checkChoice_(q, v);
    if (v !== '' && q.type === 'scale') {
      var n = Number(v);
      if (!/^\d+$/.test(v) || n < q.options.scale_min || n > q.options.scale_max) throw new Error('目盛りの範囲で回答してください：' + q.text);
    }
    if (v !== '' && q.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('日付の形式が正しくありません：' + q.text);
    if (v !== '' && q.type === 'time' && !/^\d{2}:\d{2}$/.test(v)) throw new Error('時刻の形式が正しくありません：' + q.text);
    if (v !== '' && (q.type === 'name' || q.meaning_label === 'name')) name = name || v;
    answers.push({ question_id: q.question_id, meaning_label: q.meaning_label, answer: v, text: q.text });
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var responseId = newId_('r');
  var respondentId = '';
  try {
    var now = nowIso_();
    if (email) {
      respondentId = respondentIdFor_(email);
      var existing = readAll_('Respondents').filter(function (r) { return r.respondent_id === respondentId; })[0];
      if (existing) {
        existing.name = name || existing.name;
        existing.last_seen = now;
        existing.survey_count = Number(existing.survey_count || 0) + 1;
        updateRow_('Respondents', existing._row, existing);
      } else {
        append_('Respondents', [{ respondent_id: respondentId, email: email, name: name,
          first_seen: now, last_seen: now, survey_count: 1 }]);
      }
    }
    append_('Responses', [{ response_id: responseId, survey_id: survey.survey_id,
      respondent_id: respondentId, submitted_at: now }]);
    append_('Answers', answers.map(function (a) {
      return { response_id: responseId, question_id: a.question_id, meaning_label: a.meaning_label, answer: a.answer };
    }));
  } finally {
    lock.releaseLock();
  }

  var mailed = false;
  if (email) {
    try { sendCopyMail_(email, name, survey, answers); mailed = true; } catch (err) { console.error(err); }
  }
  return { response_id: responseId, mailed: mailed };
}

/* ---------- 管理：アンケート ---------- */

function apiListSurveys_() {
  var counts = {};
  readAll_('Responses').forEach(function (r) { counts[r.survey_id] = (counts[r.survey_id] || 0) + 1; });
  return readAll_('Surveys').map(function (s) {
    var o = strip_(s);
    o.response_count = counts[s.survey_id] || 0;
    return o;
  }).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
}

function apiGetSurveyFull_(p) {
  var s = strip_(findSurvey_(String(p.survey_id)));
  s.questions = questionsOf_(s.survey_id);
  return s;
}

function apiSaveSurvey_(p) {
  var s = p.survey || {};
  var title = String(s.title || '').trim();
  if (!title) throw new Error('タイトルを入力してください。');
  var qs = Array.isArray(s.questions) ? s.questions : [];
  if (!qs.length) throw new Error('質問を1つ以上追加してください。');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var now = nowIso_();
    var surveyId = s.survey_id ? String(s.survey_id) : newId_('s');
    var existing = s.survey_id ? findSurvey_(surveyId) : null;
    var row = {
      survey_id: surveyId,
      title: title,
      description: String(s.description || ''),
      community: String(s.community || '漢の福袋'),
      status: existing ? existing.status : 'draft',
      created_at: existing ? existing.created_at : now,
      updated_at: now
    };
    if (existing) updateRow_('Surveys', existing._row, row);
    else append_('Surveys', [row]);

    var used = {};
    var questionRows = qs.map(function (q, i) {
      var type = QUESTION_TYPES.indexOf(q.type) >= 0 ? q.type : 'text';
      var label = MEANING_LABELS[q.meaning_label] ? q.meaning_label : 'other';
      if (type === 'email') label = 'email';
      if (type === 'name') label = 'name';
      var qid = String(q.question_id || '') || newId_('q');
      if (used[qid]) qid = newId_('q');
      used[qid] = true;
      if (!String(q.text || '').trim()) throw new Error((i + 1) + '問目の質問文が空です。');
      return {
        survey_id: surveyId, question_id: qid, order: i + 1,
        text: String(q.text).trim(), help_text: String(q.help_text || ''),
        type: type, required: !!q.required,
        choices: splitList_(q.choices).join(' | '),
        meaning_label: label,
        options: JSON.stringify(normalizeOptions_(type, q.options))
      };
    });
    ensureHeaders_();
    // question_id は既存を引き継ぐので、編集しても過去の回答とつながったまま
    deleteWhere_('Questions', function (q) { return q.survey_id === surveyId; });
    append_('Questions', questionRows);
    return { survey_id: surveyId };
  } finally {
    lock.releaseLock();
  }
}

function apiDuplicateSurvey_(p) {
  var src = apiGetSurveyFull_(p);
  return apiSaveSurvey_({ survey: {
    title: src.title + '（コピー）', description: src.description, community: src.community,
    questions: src.questions.map(function (q) {
      return { text: q.text, help_text: q.help_text, type: q.type, required: q.required,
        choices: q.choices, meaning_label: q.meaning_label, options: q.options };
    })
  } });
}

function apiSetStatus_(p) {
  var status = String(p.status);
  if (SURVEY_STATUSES.indexOf(status) < 0) throw new Error('不正なステータスです。');
  var s = findSurvey_(String(p.survey_id));
  s.status = status;
  s.updated_at = nowIso_();
  updateRow_('Surveys', s._row, s);
  return { survey_id: s.survey_id, status: status };
}

/* ---------- 管理：回答 ---------- */

/** p.survey_id か p.respondent_id で絞り込み。回答・AI分析・質問文をまとめて返す */
function apiListResponses_(p) {
  var responses = readAll_('Responses').filter(function (r) {
    if (p.survey_id && r.survey_id !== p.survey_id) return false;
    if (p.respondent_id && r.respondent_id !== p.respondent_id) return false;
    return true;
  });
  var ids = {};
  responses.forEach(function (r) { ids[r.response_id] = true; });

  var answersBy = {};
  readAll_('Answers').forEach(function (a) {
    if (!ids[a.response_id]) return;
    (answersBy[a.response_id] = answersBy[a.response_id] || []).push(strip_(a));
  });
  var aiBy = {};
  readAll_('AI_Analysis').forEach(function (a) { if (ids[a.response_id]) aiBy[a.response_id] = strip_(a); });
  var people = {};
  readAll_('Respondents').forEach(function (r) { people[r.respondent_id] = r; });
  var surveys = {};
  readAll_('Surveys').forEach(function (s) { surveys[s.survey_id] = s.title; });
  var questionText = {};
  readAll_('Questions').forEach(function (q) { questionText[q.question_id] = q.text; });

  return {
    questions: p.survey_id ? questionsOf_(p.survey_id) : [],
    responses: responses.map(function (r) {
      var person = people[r.respondent_id] || {};
      return {
        response_id: r.response_id, survey_id: r.survey_id, survey_title: surveys[r.survey_id] || '',
        respondent_id: r.respondent_id, email: person.email || '', name: person.name || '',
        submitted_at: r.submitted_at,
        answers: (answersBy[r.response_id] || []).map(function (a) {
          a.question_text = questionText[a.question_id] || '';
          return a;
        }),
        ai: aiBy[r.response_id] || null
      };
    }).sort(function (a, b) { return String(b.submitted_at).localeCompare(String(a.submitted_at)); })
  };
}

function apiListRespondents_() {
  return readAll_('Respondents').map(strip_)
    .sort(function (a, b) { return String(b.last_seen).localeCompare(String(a.last_seen)); });
}

/* ---------- 管理：AI分析ダッシュボード ---------- */

function apiDashboard_(p) {
  var surveyFilter = p.survey_id ? String(p.survey_id) : '';
  var responses = readAll_('Responses').filter(function (r) { return !surveyFilter || r.survey_id === surveyFilter; });
  var byId = {};
  responses.forEach(function (r) { byId[r.response_id] = r; });
  var people = {};
  readAll_('Respondents').forEach(function (r) { people[r.respondent_id] = r; });
  var surveys = {};
  readAll_('Surveys').forEach(function (s) { surveys[s.survey_id] = s.title; });

  var pain = {}, change = {}, outcomes = [], quotes = [], targets = {};
  var analyzed = 0;
  readAll_('AI_Analysis').forEach(function (a) {
    var r = byId[a.response_id];
    if (!r) return;
    analyzed++;
    var who = (people[r.respondent_id] || {}).name || '（名前なし）';
    var meta = { response_id: a.response_id, name: who, survey_title: surveys[r.survey_id] || '',
      submitted_at: r.submitted_at, respondent_id: r.respondent_id };
    splitList_(a.pain_tags).forEach(function (t) { pain[t] = (pain[t] || 0) + 1; });
    splitList_(a.change_tags).forEach(function (t) { change[t] = (change[t] || 0) + 1; });
    splitList_(a.outcome_numbers).forEach(function (o) { outcomes.push(Object.assign({ text: o }, meta)); });
    splitList_(a.recommend_target).forEach(function (t) { targets[t] = (targets[t] || 0) + 1; });
    if (a.best_quote) quotes.push(Object.assign({ text: a.best_quote, summary: a.summary }, meta));
  });

  function rank(m) {
    return Object.keys(m).map(function (k) { return { tag: k, count: m[k] }; })
      .sort(function (a, b) { return b.count - a.count || a.tag.localeCompare(b.tag); });
  }
  return {
    total_responses: responses.length,
    analyzed: analyzed,
    pending: responses.length - analyzed,
    pain_ranking: rank(pain),
    change_ranking: rank(change),
    recommend_ranking: rank(targets),
    outcomes: outcomes,
    quotes: quotes
  };
}

function apiSaveTags_(p) {
  var tags = Array.isArray(p.tags) ? p.tags : [];
  var rows = tags.map(function (t) {
    return { tag: String(t.tag || '').trim(),
      category: TAG_CATEGORIES.indexOf(t.category) >= 0 ? t.category : 'pain',
      description: String(t.description || '') };
  }).filter(function (t) { return t.tag; });
  deleteWhere_('Tags', function () { return true; });
  append_('Tags', rows);
  return { count: rows.length };
}

// ===== Ai.gs =====
/**
 * AI分析の結果を受け取って保存する。
 * お金がかからないように、このシステムは AI の API を呼ばない。
 * 管理画面が「AIへの依頼文」を作り、公嗣さんが Claude のチャット（定額プラン）に貼って、
 * 返ってきた JSON を管理画面に貼り戻す。ここではその JSON を検証して AI_Analysis と Tags に保存するだけ。
 */

function apiImportAnalysis_(p) {
  var items = Array.isArray(p.items) ? p.items : [];
  if (!items.length) throw new Error('取り込む分析結果がありません。');
  if (items.length > 200) throw new Error('一度に取り込めるのは200件までです。');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var responses = {};
    readAll_('Responses').forEach(function (r) { responses[r.response_id] = true; });
    var existing = {};
    readAll_('AI_Analysis').forEach(function (a) { existing[a.response_id] = a; });
    var known = {};
    readAll_('Tags').forEach(function (t) { known[t.category + '\u0000' + t.tag] = true; });

    var add = [], newTags = [], saved = 0, skipped = [];
    var now = nowIso_();
    items.forEach(function (it) {
      var id = String(it && it.response_id || '');
      if (!responses[id]) { skipped.push(id || '（IDなし）'); return; }
      var row = {
        response_id: id,
        summary: text_(it.summary, 1000),
        before_state: text_(it.before_state, 500),
        after_state: text_(it.after_state, 500),
        pain_tags: list_(it.pain_tags).join(' | '),
        change_tags: list_(it.change_tags).join(' | '),
        outcome_numbers: list_(it.outcome_numbers).join(' | '),
        recommend_target: list_(it.recommend_target).join(' | '),
        best_quote: text_(it.best_quote, 300),
        analyzed_at: now
      };
      if (existing[id]) updateRow_('AI_Analysis', existing[id]._row, row);
      else { add.push(row); existing[id] = row; }
      saved++;

      // 使われたタグのうち、まだタグ辞書に無いものを登録する（new_tags に説明があれば使う）
      var desc = {};
      (Array.isArray(it.new_tags) ? it.new_tags : []).forEach(function (t) {
        if (t && t.tag) desc[String(t.category) + '\u0000' + String(t.tag).trim()] = text_(t.description, 200);
      });
      [['pain', it.pain_tags], ['change', it.change_tags]].forEach(function (pair) {
        list_(pair[1]).forEach(function (t) {
          var k = pair[0] + '\u0000' + t;
          if (!known[k]) { known[k] = true; newTags.push({ tag: t, category: pair[0], description: desc[k] || '' }); }
        });
      });
    });
    append_('AI_Analysis', add);
    append_('Tags', newTags);
    return { saved: saved, skipped: skipped, new_tags: newTags.map(function (t) { return t.tag; }) };
  } finally {
    lock.releaseLock();
  }
}

function text_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max); }

function list_(v) {
  var arr = Array.isArray(v) ? v : splitList_(v);
  return arr.map(function (x) { return String(x).trim().slice(0, 60); }).filter(function (x) { return x !== ''; }).slice(0, 10);
}

/**
 * 以前の版が作った「10分ごとのAI分析」トリガーの後始末。
 * 古いトリガーが動いたら、自分自身を消して何もしない。
 */
function analyzePendingTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'analyzePendingTrigger') ScriptApp.deleteTrigger(t);
  });
}

// ===== Mail.gs =====
/** 回答者に回答内容のコピーをメールで送る */
function sendCopyMail_(email, name, survey, answers) {
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var visible = answers.filter(function (a) { return a.answer !== ''; });
  var plain = [
    (name ? name + ' 様' : '') ,
    '',
    '「' + survey.title + '」へのご回答ありがとうございました。',
    '以下の内容で受け付けました。',
    '',
    visible.map(function (a) { return '■ ' + a.text + '\n' + a.answer; }).join('\n\n'),
    '',
    '――',
    survey.community || '漢の福袋'
  ].join('\n');

  var html =
    '<div style="background:#0d0d0d;padding:24px;font-family:sans-serif;color:#eee">' +
    '<div style="max-width:560px;margin:0 auto;border:1px solid #c9a24a;padding:24px">' +
    '<p style="color:#c9a24a;letter-spacing:.2em;margin:0 0 8px">' + esc(survey.community || '漢の福袋') + '</p>' +
    '<h2 style="margin:0 0 16px;color:#fff">' + esc(survey.title) + '</h2>' +
    '<p>' + (name ? esc(name) + ' 様<br>' : '') + 'ご回答ありがとうございました。以下の内容で受け付けました。</p>' +
    visible.map(function (a) {
      return '<p style="margin:16px 0 4px;color:#c9a24a;font-weight:bold">' + esc(a.text) + '</p>' +
        '<p style="margin:0;white-space:pre-wrap">' + esc(a.answer) + '</p>';
    }).join('') +
    '</div></div>';

  MailApp.sendEmail({
    to: email,
    subject: '【' + (survey.community || '漢の福袋') + '】ご回答の控え：' + survey.title,
    body: plain,
    htmlBody: html,
    name: survey.community || '漢の福袋'
  });
}

// ===== Setup.gs =====
/**
 * 初回だけ GAS エディタで「setup」を実行する。
 * - データ用スプレッドシートを作成（既にあれば足りないシートだけ追加）
 * - 管理者キーを自動生成してスクリプトプロパティ ADMIN_KEY に保存（コードには残らない）
 * - サンプルのアンケートを1件作成
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('漢の福袋 アンケート DB');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  _ssCache = ss;

  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var header = SCHEMA[name];
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var first = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);

  if (readAll_('Tags').length === 0) append_('Tags', DEFAULT_TAGS);
  if (readAll_('Surveys').length === 0) createSampleSurvey_();

  if (!props.getProperty('ADMIN_KEY')) {
    props.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, ''));
  }

  analyzePendingTrigger(); // 以前の版の自動AI分析トリガーが残っていれば消す

  console.log('スプレッドシート: ' + ss.getUrl());
  console.log('管理者キーは「プロジェクトの設定 > スクリプト プロパティ > ADMIN_KEY」で確認してください。');
}

var DEFAULT_TAGS = [
  { tag: '自信がない', category: 'pain', description: '自分に自信が持てず一歩を踏み出せない' },
  { tag: '仕事の伸び悩み', category: 'pain', description: '収入・成果・キャリアが頭打ち' },
  { tag: '人間関係の悩み', category: 'pain', description: '家族・職場・恋愛などの関係に悩む' },
  { tag: '習慣が続かない', category: 'pain', description: '運動・勉強・早起きなどが三日坊主' },
  { tag: '孤独・仲間不足', category: 'pain', description: '本音で話せる仲間がいない' },
  { tag: '体型・健康', category: 'pain', description: '体重・体力・健康面の悩み' },
  { tag: '行動力が上がった', category: 'change', description: '決めたことをすぐ実行できるようになった' },
  { tag: '自信がついた', category: 'change', description: '自己肯定感・自信が高まった' },
  { tag: '仲間ができた', category: 'change', description: '本音で語れる仲間・つながりができた' },
  { tag: '考え方が変わった', category: 'change', description: '物事の捉え方・価値観が変わった' },
  { tag: '習慣が身についた', category: 'change', description: '良い習慣が定着した' },
  { tag: '収入アップ', category: 'outcome', description: '売上・年収など金額の成果' },
  { tag: '体重減少', category: 'outcome', description: '減量など体の数値の成果' }
];

function createSampleSurvey_() {
  apiSaveSurvey_({ survey: {
    title: '漢の福袋 合宿アンケート（サンプル）',
    description: '合宿お疲れさまでした。率直な感想を聞かせてください。今後の企画づくりに活かします。',
    community: '漢の福袋',
    questions: [
      { text: 'お名前', type: 'name', required: true, meaning_label: 'name' },
      { text: 'メールアドレス', help_text: '回答の控えをお送りします', type: 'email', required: true, meaning_label: 'email' },
      { text: '参加する前、どんなことに悩んでいましたか？', type: 'textarea', required: true, meaning_label: 'pain' },
      { text: '参加して、何が一番変わりましたか？', type: 'textarea', required: true, meaning_label: 'change' },
      { text: '特に効いた体験・考え方を教えてください', type: 'textarea', required: false, meaning_label: 'insight' },
      { text: '数字で表せる成果があれば教えてください', help_text: '例：体重 -5kg、売上 月+30万円', type: 'text', required: false, meaning_label: 'outcome' },
      { text: '満足度を教えてください', help_text: '1（不満）〜10（大満足）', type: 'scale', required: true, meaning_label: 'satisfaction' },
      { text: 'どんな人にこの合宿を勧めたいですか？', type: 'text', required: false, meaning_label: 'recommend' },
      { text: 'これから参加する人へ、ひと言お願いします', type: 'textarea', required: false, meaning_label: 'quote' },
      { text: '紹介文やSNSでの掲載について', type: 'choice', required: true, meaning_label: 'other',
        choices: ['名前ありで掲載OK', 'イニシャルなら掲載OK', '掲載NG'] }
    ]
  } });
}
