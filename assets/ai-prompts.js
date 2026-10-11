// AI への「依頼文」を作り、Claude のチャットから返ってきた答え（JSON）を読み取る。
// お金がかからないように、このシステムは AI の API を呼ばない。
// 依頼文をコピー → Claude のチャット（定額プラン）に貼る → 返ってきた答えを管理画面に貼り戻す、という流れ。
(function () {
  var TYPES = {
    text: '記述式（1行）', textarea: '段落（複数行）', choice: 'ラジオボタン（1つ選ぶ）', checkbox: 'チェックボックス（複数選べる）',
    dropdown: 'プルダウン', scale: '均等目盛（scale_min〜scale_max の数字で評価）', date: '日付', time: '時刻',
    email: 'メールアドレス', name: '名前'
  };
  var CHOICE_TYPES = { choice: true, checkbox: true, dropdown: true };

  function labelList(labels) {
    return Object.keys(labels).map(function (k) { return '- ' + k + '：' + labels[k]; }).join('\n');
  }

  var SURVEY_FORMAT = [
    '答えは、次の形の JSON を ```json のコードブロック1つだけで返してください（説明文は不要です）。',
    '```json',
    '{',
    '  "title": "アンケートのタイトル",',
    '  "description": "回答者へのひと言（2〜4文）",',
    '  "changes": ["作った・直した内容の要点を3〜8個"],',
    '  "questions": [',
    '    {',
    '      "question_id": "既存の質問を残す・直すときはその ID。新しい質問は空文字",',
    '      "text": "質問文",',
    '      "help_text": "補足説明（不要なら空文字）",',
    '      "type": "形式（下の一覧の英字）",',
    '      "required": true,',
    '      "choices": ["choice / checkbox / dropdown のときだけ選択肢。ほかは空配列"],',
    '      "meaning_label": "意味ラベル（下の一覧の英字）",',
    '      "allow_other": false,',
    '      "scale_min": 1, "scale_max": 10, "label_min": "", "label_max": ""',
    '    }',
    '  ]',
    '}',
    '```',
    '- allow_other は choice / checkbox で「その他（自由記入）」を付けるとき true。',
    '- scale_min は 0 か 1、scale_max は 2〜10。label_min / label_max は目盛りの両端の言葉（不要なら空文字）。scale 以外では 1・10・空文字のままでよい。'
  ].join('\n');

  function designRules(labels) {
    return [
      'あなたはコミュニティ「漢の福袋」のアンケート設計を手伝う担当です。',
      '回答をあとで人をまたいで分析できるアンケートを、日本語で設計してください。',
      '',
      '使える形式（type）：',
      Object.keys(TYPES).map(function (k) { return '- ' + k + '：' + TYPES[k]; }).join('\n'),
      '',
      '意味ラベル（meaning_label。AI分析で人をまたいで集計するための共通の分類）：',
      labelList(labels),
      '',
      '設計のルール：',
      '- 1問目は name（お名前）、2問目は email（メールアドレス。補足に「回答の控えをお送りします」）にする。',
      '- 意味ラベルは質問の中身に合うものを選ぶ（悩み=pain、変化=change、成果=outcome など）。',
      '- 自由記述だけに頼らず、比べられる数値（scale）や選択肢の質問も入れる。',
      '- 紹介文や声として使う可能性があるなら、掲載してよいかを選択肢で聞く。',
      '- 1つの質問で2つのことを聞かない。答えやすい言葉にする。全体で回答10〜15分以内を目安にする。',
      '- 必須は本当に必要なものだけにする。'
    ].join('\n');
  }

  function draft(input, labels) {
    return [
      designRules(labels), '',
      '次の条件で、アンケートを新しく作ってください。question_id はすべて空文字にしてください。', '',
      '【何のアンケートか】', input.purpose, '',
      '【誰に答えてもらうか】', input.audience, '',
      '【回答から何を知りたいか・何に使うか】', input.goal, '',
      SURVEY_FORMAT
    ].join('\n');
  }

  function revise(survey, instruction, labels) {
    var current = {
      title: survey.title || '', description: survey.description || '',
      questions: (survey.questions || []).map(function (q) {
        var o = q.options || {};
        return { question_id: q.question_id || '', text: q.text || '', help_text: q.help_text || '', type: q.type,
          required: !!q.required, choices: [].concat(q.choices || []), meaning_label: q.meaning_label || 'other',
          allow_other: !!o.allow_other, scale_min: o.scale_min === 0 ? 0 : 1, scale_max: o.scale_max || 10,
          label_min: o.label_min || '', label_max: o.label_max || '' };
      })
    };
    return [
      designRules(labels), '',
      '今のアンケートを、下の依頼に沿って直してください。',
      '- 依頼に関係ない質問は、文言も question_id もそのまま残す（過去の回答とのつながりを保つため）。',
      '- 削除する質問は出力から外す。新しい質問の question_id は空文字。', '',
      '【今のアンケート】', '```json', JSON.stringify(current, null, 1), '```', '',
      '【直してほしいこと】', instruction, '',
      SURVEY_FORMAT
    ].join('\n');
  }

  // 回答の分析。名前とメールアドレスは渡さない
  function analysis(responses, tags) {
    var cats = { pain: '悩み', change: '変化', outcome: '成果' };
    var tagText = Object.keys(cats).map(function (c) {
      var names = tags.filter(function (t) { return t.category === c; }).map(function (t) { return t.tag; });
      return '- ' + c + '（' + cats[c] + '）：' + (names.length ? names.join(' / ') : '（まだなし）');
    }).join('\n');
    var body = responses.map(function (r) {
      var lines = r.answers.filter(function (a) {
        return a.answer !== '' && a.meaning_label !== 'email' && a.meaning_label !== 'name';
      }).map(function (a) {
        return '■ [' + a.meaning_label + '] ' + (a.question_text || a.question_id) + '\n' + a.answer;
      });
      return '### response_id: ' + r.response_id + '（' + (r.survey_title || '') + '）\n' + lines.join('\n');
    }).join('\n\n');
    return [
      'あなたはコミュニティ「漢の福袋」のアンケート回答を分析する担当です。',
      '下の回答を1件ずつ読み、顧客分析に使える形に整理してください。',
      '',
      'ルール：',
      '- 回答に書かれていないことは推測で補わない。根拠がなければ空文字・空配列にする。',
      '- タグは「既存タグ」を最優先で使う。意味が近ければ既存タグを選び、言い換えて新しいタグを作らない。',
      '- どうしても当てはまらないときだけ新しいタグを作り、new_tags にも入れる（8文字前後の短い名詞句）。',
      '- best_quote は本人の言葉をなるべくそのまま使い、紹介文に載せられる一文にする（なければ空文字）。',
      '- outcome_numbers は数字が含まれる成果だけ。',
      '',
      '既存タグ：', tagText, '',
      '答えは、次の形の JSON 配列を ```json のコードブロック1つだけで返してください（回答1件につき1つ。説明文は不要です）。',
      '```json',
      '[',
      '  {',
      '    "response_id": "回答のID（そのまま写す）",',
      '    "summary": "回答全体の要約（2〜3文）",',
      '    "before_state": "参加前の状態（1〜2文。不明なら空文字）",',
      '    "after_state": "参加後の状態（1〜2文。不明なら空文字）",',
      '    "pain_tags": ["悩みタグ（0〜4個）"],',
      '    "change_tags": ["変化タグ（0〜4個）"],',
      '    "outcome_numbers": ["数字で表せる成果（例：体重 -5kg）"],',
      '    "recommend_target": ["この体験を勧めたい人物像（0〜3個）"],',
      '    "best_quote": "紹介文に使える本人の一言",',
      '    "new_tags": [{ "tag": "新しく作ったタグ", "category": "pain か change", "description": "説明" }]',
      '  }',
      ']',
      '```',
      '',
      '【回答（' + responses.length + '件）】', '', body
    ].join('\n');
  }

  // 貼り付けられた文章から JSON を取り出す（```json ブロックがあればその中身）
  function extractJson(text) {
    var s = String(text || '').trim();
    if (!s) throw new Error('Claude の答えを貼り付けてください。');
    var m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) s = m[1].trim();
    else {
      var start = s.search(/[\[{]/);
      var end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
      if (start >= 0 && end > start) s = s.slice(start, end + 1);
    }
    try { return JSON.parse(s); } catch (e) {
      throw new Error('答えを読み取れませんでした。Claude の答えを、最初から最後までそのまま貼り付けてください。');
    }
  }

  function normalizeSurvey(obj, labels) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.questions) || !obj.questions.length) {
      throw new Error('アンケートの形になっていません。依頼文をもう一度コピーして、Claude に頼み直してください。');
    }
    return {
      title: String(obj.title || ''), description: String(obj.description || ''),
      changes: Array.isArray(obj.changes) ? obj.changes.map(String) : [],
      questions: obj.questions.map(function (q) {
        var type = TYPES[q.type] ? q.type : 'text';
        var options = {};
        if (type === 'choice' || type === 'checkbox') options.allow_other = !!q.allow_other;
        if (type === 'scale') {
          options.scale_min = Number(q.scale_min) === 0 ? 0 : 1;
          var max = Math.round(Number(q.scale_max));
          options.scale_max = max >= 2 && max <= 10 ? max : 10;
          options.label_min = String(q.label_min || ''); options.label_max = String(q.label_max || '');
        }
        return {
          question_id: String(q.question_id || ''), text: String(q.text || ''), help_text: String(q.help_text || ''),
          type: type, required: !!q.required,
          choices: CHOICE_TYPES[type] && Array.isArray(q.choices) ? q.choices.map(String).filter(Boolean) : [],
          meaning_label: labels[q.meaning_label] ? q.meaning_label : 'other', options: options
        };
      })
    };
  }

  function normalizeAnalysis(arr) {
    if (arr && !Array.isArray(arr) && Array.isArray(arr.items)) arr = arr.items;
    if (!Array.isArray(arr) || !arr.length) {
      throw new Error('分析結果の形になっていません。依頼文をもう一度コピーして、Claude に頼み直してください。');
    }
    return arr.filter(function (x) { return x && x.response_id; });
  }

  window.AiPrompts = { draft: draft, revise: revise, analysis: analysis, extractJson: extractJson,
    normalizeSurvey: normalizeSurvey, normalizeAnalysis: normalizeAnalysis };
})();
