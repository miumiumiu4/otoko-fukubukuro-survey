/**
 * AI分析：1回答ごとに Claude API で構造化し、AI_Analysis シートへ保存する。
 * APIキーはスクリプトプロパティ ANTHROPIC_API_KEY（コードには書かない）。
 * 既存タグ（Tags シート）を優先して使わせ、表記ゆれを防ぐ。新しいタグは自動で Tags に追加。
 */

var AI_MODEL = 'claude-opus-5-5';

var AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'before_state', 'after_state', 'pain_tags', 'change_tags',
    'outcome_numbers', 'recommend_target', 'best_quote', 'new_tags'],
  properties: {
    summary: { type: 'string', description: '回答全体の要約（2〜3文）' },
    before_state: { type: 'string', description: '参加前の状態（1〜2文。不明なら空文字）' },
    after_state: { type: 'string', description: '参加後の状態（1〜2文。不明なら空文字）' },
    pain_tags: { type: 'array', items: { type: 'string' }, description: '悩みタグ（0〜4個）' },
    change_tags: { type: 'array', items: { type: 'string' }, description: '変化タグ（0〜4個）' },
    outcome_numbers: { type: 'array', items: { type: 'string' },
      description: '数字で表せる成果（例: 体重 -5kg、売上 月+30万円）。回答に書かれたものだけ' },
    recommend_target: { type: 'array', items: { type: 'string' }, description: 'この体験を勧めたい人物像（0〜3個）' },
    best_quote: { type: 'string', description: '紹介文にそのまま使える、本人の言葉の一言（原文を活かす。なければ空文字）' },
    new_tags: {
      type: 'array',
      description: '既存タグに無く、今回新しく作ったタグだけ',
      items: {
        type: 'object', additionalProperties: false, required: ['tag', 'category', 'description'],
        properties: {
          tag: { type: 'string' },
          category: { type: 'string', enum: ['pain', 'change', 'outcome'] },
          description: { type: 'string' }
        }
      }
    }
  }
};

var AI_SYSTEM = [
  'あなたはコミュニティ「漢の福袋」のアンケート回答を分析する担当です。',
  '回答者1人分の回答を読み、顧客分析に使える形に構造化してください。',
  '',
  'ルール:',
  '- 回答に書かれていないことは推測で補わない。根拠がなければ空文字・空配列にする。',
  '- タグは「既存タグ一覧」にあるものを最優先で使う。意味が近ければ既存タグを選び、言い換えて新タグを作らない。',
  '- どうしても当てはまらない時だけ新タグを作り、new_tags にも入れる。新タグは8文字前後の短い名詞句にする。',
  '- best_quote は本人の言葉をなるべくそのまま使い、紹介文に載せられる一文にする（誤字の修正程度はよい）。',
  '- outcome_numbers は数字が含まれる成果だけ。'
].join('\n');

function analyzeResponse_(responseId, force) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY が未設定です（スクリプトプロパティに設定してください）。');

  var existing = readAll_('AI_Analysis').filter(function (a) { return a.response_id === responseId; })[0];
  if (existing && !force) return strip_(existing);

  var response = readAll_('Responses').filter(function (r) { return r.response_id === responseId; })[0];
  if (!response) throw new Error('回答が見つかりません: ' + responseId);
  var survey = findSurvey_(response.survey_id);
  var qText = {};
  questionsOf_(survey.survey_id).forEach(function (q) { qText[q.question_id] = q.text; });
  var answers = readAll_('Answers').filter(function (a) { return a.response_id === responseId; });
  var tags = readAll_('Tags');

  var lines = answers
    .filter(function (a) { return a.meaning_label !== 'email' && a.answer !== ''; })
    .map(function (a) {
      var label = MEANING_LABELS[a.meaning_label] || a.meaning_label;
      return '■ [' + a.meaning_label + '：' + label + '] ' + (qText[a.question_id] || a.question_id) + '\n' + a.answer;
    });
  var tagList = TAG_CATEGORIES.map(function (c) {
    var names = tags.filter(function (t) { return t.category === c; }).map(function (t) { return t.tag; });
    return c + ': ' + (names.length ? names.join(' / ') : '（まだなし）');
  }).join('\n');

  var userText = '<survey>' + survey.title + '</survey>\n\n<existing_tags>\n' + tagList +
    '\n</existing_tags>\n\n<answers>\n' + lines.join('\n\n') + '\n</answers>';

  var result = callClaude_(key, userText);

  var row = {
    response_id: responseId,
    summary: result.summary,
    before_state: result.before_state,
    after_state: result.after_state,
    pain_tags: (result.pain_tags || []).join(' | '),
    change_tags: (result.change_tags || []).join(' | '),
    outcome_numbers: (result.outcome_numbers || []).join(' | '),
    recommend_target: (result.recommend_target || []).join(' | '),
    best_quote: result.best_quote,
    analyzed_at: nowIso_()
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var again = readAll_('AI_Analysis').filter(function (a) { return a.response_id === responseId; })[0];
    if (again) updateRow_('AI_Analysis', again._row, row);
    else append_('AI_Analysis', [row]);

    // 使われたタグのうち Tags に無いものを登録（new_tags の説明を優先）
    var known = {};
    readAll_('Tags').forEach(function (t) { known[t.category + '\u0000' + t.tag] = true; });
    var desc = {};
    (result.new_tags || []).forEach(function (t) { desc[t.category + '\u0000' + t.tag] = t.description; });
    var add = [];
    [['pain', result.pain_tags], ['change', result.change_tags]].forEach(function (pair) {
      (pair[1] || []).forEach(function (t) {
        var k = pair[0] + '\u0000' + t;
        if (!known[k]) { known[k] = true; add.push({ tag: t, category: pair[0], description: desc[k] || '' }); }
      });
    });
    append_('Tags', add);
  } finally {
    lock.releaseLock();
  }
  return row;
}

function callClaude_(key, userText) {
  var body = {
    model: AI_MODEL,
    max_tokens: 16000,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: AI_SCHEMA }
    },
    // 安全分類器で断られた場合はサーバー側で自動的に別モデルへ切り替える
    fallbacks: 'default',
    system: AI_SYSTEM,
    messages: [{ role: 'user', content: userText }]
  };
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var data = JSON.parse(res.getContentText() || '{}');
  if (code !== 200) {
    throw new Error('Claude API エラー (' + code + '): ' + (data.error && data.error.message || res.getContentText().slice(0, 300)));
  }
  if (data.stop_reason === 'refusal') throw new Error('AIがこの回答の分析を見送りました。');
  if (data.stop_reason === 'max_tokens') throw new Error('AIの出力が長すぎて途中で切れました。');
  var text = (data.content || []).filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; }).join('');
  return JSON.parse(text);
}

/** 未分析の回答をまとめて分析（時間主導トリガーと管理画面ボタンから呼ぶ） */
function analyzePending_(limit) {
  if (!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY')) {
    return { analyzed: 0, remaining: 0, errors: ['ANTHROPIC_API_KEY が未設定です。'] };
  }
  var done = {};
  readAll_('AI_Analysis').forEach(function (a) { done[a.response_id] = true; });
  var pending = readAll_('Responses').filter(function (r) { return !done[r.response_id]; });
  var start = Date.now();
  var count = 0, errors = [];
  for (var i = 0; i < pending.length && count < limit; i++) {
    if (Date.now() - start > 240000) break; // GAS の6分制限に余裕を持たせる
    try { analyzeResponse_(pending[i].response_id, false); count++; } catch (err) {
      errors.push(pending[i].response_id + ': ' + err.message);
      count++;
    }
  }
  return { analyzed: count - errors.length, remaining: Math.max(pending.length - count, 0), errors: errors };
}

/** 時間主導トリガー用 */
function analyzePendingTrigger() {
  var r = analyzePending_(10);
  console.log(JSON.stringify(r));
}
