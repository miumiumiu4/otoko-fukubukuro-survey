/**
 * ウェブアプリの入口。GitHub Pages から fetch(POST, Content-Type: text/plain) で呼ばれる。
 * body = JSON 文字列 { action, ...params, adminKey? }
 * 返り値 = { ok: true, data } または { ok: false, error }
 */

var PUBLIC_ACTIONS = {
  getSurvey: apiGetSurvey_,
  submit: apiSubmit_
};

var ADMIN_ACTIONS = {
  ping: function () { return { labels: MEANING_LABELS, types: QUESTION_TYPES }; },
  listSurveys: apiListSurveys_,
  getSurveyFull: apiGetSurveyFull_,
  saveSurvey: apiSaveSurvey_,
  duplicateSurvey: apiDuplicateSurvey_,
  setStatus: apiSetStatus_,
  listResponses: apiListResponses_,
  listRespondents: apiListRespondents_,
  dashboard: apiDashboard_,
  analyzePending: function (p) { return analyzePending_(Math.min(Number(p.limit) || 5, 10)); },
  analyzeResponse: function (p) { return analyzeResponse_(String(p.response_id), true); },
  listTags: function () { return readAll_('Tags').map(strip_); },
  saveTags: apiSaveTags_
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
      checkAdmin_(p.adminKey);
      return json_({ ok: true, data: ADMIN_ACTIONS[action](p) });
    }
    throw new Error('不明な操作です: ' + action);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkAdmin_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!expected) throw new Error('ADMIN_KEY が未設定です。');
  if (!key || !safeEqual_(String(key), expected)) {
    Utilities.sleep(800); // 総当たり対策のささやかな遅延
    throw new Error('管理者キーが違います。');
  }
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
        required: q.required, choices: q.choices };
    })
  };
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
    v = v === undefined || v === null ? '' : String(v).trim().slice(0, 5000);
    if (q.required && v === '') throw new Error('未回答の必須項目があります：' + q.text);
    if (v !== '' && (q.type === 'email' || q.meaning_label === 'email')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('メールアドレスの形式が正しくありません。');
      email = email || v.toLowerCase();
    }
    if (v !== '' && q.type === 'choice' && q.choices.length && q.choices.indexOf(v) < 0) {
      throw new Error('選択肢にない回答です：' + q.text);
    }
    if (v !== '' && q.type === 'scale' && !/^([1-9]|10)$/.test(v)) throw new Error('数値で回答してください：' + q.text);
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
        meaning_label: label
      };
    });
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
        choices: q.choices, meaning_label: q.meaning_label };
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
    ai_ready: !!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'),
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
