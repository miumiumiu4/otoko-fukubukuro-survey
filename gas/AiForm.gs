/**
 * 管理画面の「AIで作る」「AIに修正依頼」。
 * AI が作った案は保存せずに返すだけ。管理画面で確認して「保存する」を押したときに初めて登録される。
 */

var FORM_QUESTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['question_id', 'text', 'help_text', 'type', 'required', 'choices', 'meaning_label',
    'allow_other', 'scale_min', 'scale_max', 'label_min', 'label_max'],
  properties: {
    question_id: { type: 'string', description: '既存の質問を残す・直すときはその question_id。新しい質問は空文字' },
    text: { type: 'string' },
    help_text: { type: 'string', description: '補足説明。不要なら空文字' },
    type: { type: 'string', enum: QUESTION_TYPES },
    required: { type: 'boolean' },
    choices: { type: 'array', items: { type: 'string' }, description: 'choice / checkbox / dropdown のときだけ。それ以外は空配列' },
    meaning_label: { type: 'string', enum: Object.keys(MEANING_LABELS) },
    allow_other: { type: 'boolean', description: 'choice / checkbox で「その他（自由記入）」を出すか' },
    scale_min: { type: 'integer', description: 'scale のときの最小値（0 か 1）。それ以外は 1' },
    scale_max: { type: 'integer', description: 'scale のときの最大値（2〜10）。それ以外は 10' },
    label_min: { type: 'string', description: 'scale の最小値側の言葉。不要なら空文字' },
    label_max: { type: 'string', description: 'scale の最大値側の言葉。不要なら空文字' }
  }
};

var FORM_SURVEY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'description', 'questions', 'changes'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string', description: '回答者へのひと言（2〜4文）' },
    questions: { type: 'array', items: FORM_QUESTION_SCHEMA },
    changes: { type: 'array', items: { type: 'string' }, description: '作った・直した内容の要点（日本語で3〜8項目）' }
  }
};

function formSystemPrompt_() {
  var labels = Object.keys(MEANING_LABELS).map(function (k) { return k + '（' + MEANING_LABELS[k] + '）'; }).join('、');
  return [
    'あなたはコミュニティ「漢の福袋」のアンケート設計を手伝う担当です。',
    '回答があとで人をまたいで分析できるアンケートを、日本語で設計してください。',
    '',
    '使える質問の形式（type）:',
    'text=1行テキスト、textarea=複数行テキスト、choice=選択肢（1つ選ぶ）、checkbox=チェックボックス（複数回答）、',
    'dropdown=プルダウン、scale=均等目盛（scale_min〜scale_max、両端の言葉は label_min / label_max）、',
    'date=日付、time=時刻、email=メールアドレス、name=名前',
    '',
    '意味ラベル（meaning_label）: ' + labels,
    '',
    '設計のルール:',
    '- 1問目は name（お名前）、2問目は email（メールアドレス、補足に「回答の控えをお送りします」）にする。',
    '- 意味ラベルは質問の中身に合うものを選ぶ。悩み=pain、変化=change、成果=outcome のように、AI分析で集計しやすくする。',
    '- 自由記述だけに頼らず、比べられる数値（scale）や選択肢の質問も入れる。',
    '- 紹介文や声として使う可能性があるなら、掲載してよいかを選択肢で聞く。',
    '- 1つの質問で2つのことを聞かない。答えやすい言葉にする。全体で回答10〜15分以内を目安にする。',
    '- 必須は本当に必要なものだけにする。'
  ].join('\n');
}

function apiAiDraftSurvey_(p) {
  var key = requireAiKey_();
  var purpose = String(p.purpose || '').trim(), audience = String(p.audience || '').trim(), goal = String(p.goal || '').trim();
  if (!purpose || !audience || !goal) throw new Error('3つの質問すべてに答えてください。');
  var userText = '次の条件でアンケートを新しく作ってください。question_id はすべて空文字にしてください。\n\n' +
    '<purpose>' + purpose.slice(0, 2000) + '</purpose>\n<audience>' + audience.slice(0, 2000) + '</audience>\n<goal>' + goal.slice(0, 2000) + '</goal>';
  return toEditorSurvey_(callClaude_(key, formSystemPrompt_(), userText, FORM_SURVEY_SCHEMA, 'low'));
}

function apiAiReviseSurvey_(p) {
  var key = requireAiKey_();
  var instruction = String(p.instruction || '').trim();
  if (!instruction) throw new Error('どう直したいかを書いてください。');
  var s = p.survey || {};
  var current = {
    title: s.title || '', description: s.description || '',
    questions: (s.questions || []).map(function (q) {
      return { question_id: q.question_id || '', text: q.text || '', help_text: q.help_text || '', type: q.type,
        required: !!q.required, choices: [].concat(q.choices || []), meaning_label: q.meaning_label || 'other',
        options: q.options || {} };
    })
  };
  var userText = '今のアンケートを、依頼に沿って直してください。\n' +
    '- 依頼に関係ない質問は、文言も question_id もそのまま残す（過去の回答とつながりを保つため）。\n' +
    '- 削除する質問は出力から外す。新しい質問の question_id は空文字。\n\n' +
    '<current_survey>' + JSON.stringify(current) + '</current_survey>\n\n<request>' + instruction.slice(0, 3000) + '</request>';
  var out = toEditorSurvey_(callClaude_(key, formSystemPrompt_(), userText, FORM_SURVEY_SCHEMA, 'low'));
  // AI が存在しない question_id を書いた場合は新しい質問として扱う
  var known = {};
  current.questions.forEach(function (q) { if (q.question_id) known[q.question_id] = true; });
  out.questions.forEach(function (q) { if (!known[q.question_id]) q.question_id = ''; });
  return out;
}

function requireAiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('AIのキー（ANTHROPIC_API_KEY）が未設定のため、AI機能は使えません。');
  return key;
}

/** AI の出力を、管理画面の編集画面がそのまま読める形にする */
function toEditorSurvey_(r) {
  return {
    title: String(r.title || ''), description: String(r.description || ''), changes: r.changes || [],
    questions: (r.questions || []).map(function (q) {
      var type = QUESTION_TYPES.indexOf(q.type) >= 0 ? q.type : 'text';
      return {
        question_id: String(q.question_id || ''), text: String(q.text || ''), help_text: String(q.help_text || ''),
        type: type, required: !!q.required,
        choices: (type === 'choice' || type === 'checkbox' || type === 'dropdown') ? (q.choices || []) : [],
        meaning_label: MEANING_LABELS[q.meaning_label] ? q.meaning_label : 'other',
        options: normalizeOptions_(type, q)
      };
    })
  };
}
