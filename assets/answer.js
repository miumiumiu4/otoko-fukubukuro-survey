(function () {
  var api = window.SurveyApi, h = api.h;
  var app = document.getElementById('app');
  var surveyId = new URLSearchParams(location.search).get('s');
  var survey = null;
  var DRAFT_KEY = 'ofs-draft-' + surveyId;

  function show(node) { app.replaceChildren(node); }
  function notice(title, text) { return h('div', { class: 'notice' }, [h('h2', { text: title }), h('p', { text: text })]); }

  function saveDraft(values) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(values)); } catch (e) {} }
  function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}'); } catch (e) { return {}; } }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

  var OTHER = 'その他: ';
  function isGroup(q) { return q.type === 'choice' || q.type === 'checkbox' || q.type === 'scale'; }
  function opts(q) { return q.options || {}; }

  // 選択肢（1つ／複数）。「その他」を許す質問は、最後に自由記入つきの「その他」を出す
  function choiceList(q, value, multi) {
    var name = 'q_' + q.question_id;
    var picked = multi ? [].concat(value || []) : [value];
    var otherText = '';
    picked.forEach(function (v) { if (typeof v === 'string' && v.indexOf(OTHER) === 0) otherText = v.slice(OTHER.length); });
    var items = q.choices.map(function (c) {
      return h('label', { class: 'choice' }, [
        h('input', { type: multi ? 'checkbox' : 'radio', name: name, value: c, checked: picked.indexOf(c) >= 0 }), h('span', { text: c })
      ]);
    });
    if (opts(q).allow_other) {
      var otherBox = h('input', { type: multi ? 'checkbox' : 'radio', name: name, value: '__other__', checked: !!otherText });
      var otherInput = h('input', { type: 'text', name: 'o_' + q.question_id, value: otherText, placeholder: '自由に入力', 'aria-label': 'その他の内容' });
      otherInput.addEventListener('input', function () { if (otherInput.value) otherBox.checked = true; });
      items.push(h('label', { class: 'choice other' }, [otherBox, h('span', { text: 'その他：' }), otherInput]));
    }
    return h('div', { class: 'choices', role: multi ? 'group' : 'radiogroup' }, items);
  }

  function inputFor(q, value) {
    var name = 'q_' + q.question_id;
    if (q.type === 'textarea') return h('textarea', { id: name, name: name, value: value || '' });
    if (q.type === 'choice') return choiceList(q, value, false);
    if (q.type === 'checkbox') return choiceList(q, value, true);
    if (q.type === 'dropdown') {
      return h('select', { id: name, name: name }, [h('option', { value: '', text: '選択してください' })].concat(q.choices.map(function (c) {
        return h('option', { value: c, text: c, selected: value === c });
      })));
    }
    if (q.type === 'scale') {
      var o = opts(q), min = o.scale_min === 0 ? 0 : 1, max = o.scale_max || 10, nums = [];
      for (var i = min; i <= max; i++) nums.push(i);
      var grid = h('div', { class: 'scale', role: 'radiogroup' }, nums.map(function (n) {
        return h('label', {}, [
          h('input', { type: 'radio', name: name, value: String(n), checked: String(value) === String(n), 'aria-label': String(n) }),
          h('span', { text: String(n) })
        ]);
      }));
      grid.style.gridTemplateColumns = 'repeat(' + Math.min(nums.length, 6) + ', 1fr)';
      return h('div', {}, [grid, h('div', { class: 'scale-ends' }, [
        h('span', { text: min + ' ' + (o.label_min || '低い') }), h('span', { text: max + ' ' + (o.label_max || '高い') })
      ])]);
    }
    var type = { email: 'email', date: 'date', time: 'time' }[q.type] || 'text';
    var attrs = { id: name, name: name, type: type, value: value || '' };
    if (q.type === 'email') { attrs.autocomplete = 'email'; attrs.inputmode = 'email'; }
    if (q.type === 'name') attrs.autocomplete = 'name';
    return h('input', attrs);
  }

  // checkbox は配列、それ以外は文字列で返す。「その他」は「その他: 〜」に置き換える
  function readValues(form) {
    var fd = new FormData(form), out = {};
    survey.questions.forEach(function (q) {
      var other = String(fd.get('o_' + q.question_id) || '').trim();
      var vals = fd.getAll('q_' + q.question_id).map(function (v) {
        return v === '__other__' ? (other ? OTHER + other : '') : String(v).trim();
      }).filter(function (v) { return v !== ''; });
      out[q.question_id] = q.type === 'checkbox' ? vals : (vals[0] || '');
    });
    return out;
  }

  function isEmpty(v) { return Array.isArray(v) ? v.length === 0 : !v; }

  function validate(form, values) {
    var firstBad = null;
    survey.questions.forEach(function (q) {
      var box = form.querySelector('[data-q="' + q.question_id + '"]');
      var msg = '';
      var v = values[q.question_id];
      var otherPicked = !!form.querySelector('[name="q_' + q.question_id + '"][value="__other__"]:checked');
      var otherEmpty = otherPicked && !String((form.querySelector('[name="o_' + q.question_id + '"]') || {}).value || '').trim();
      if (otherEmpty) msg = '「その他」の内容を入力してください';
      else if (q.required && isEmpty(v)) msg = 'この項目は必須です';
      else if (v && q.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = 'メールアドレスの形式が正しくありません';
      box.classList.toggle('invalid', !!msg);
      var err = box.querySelector('.err');
      err.textContent = msg;
      err.hidden = !msg;
      if (msg && !firstBad) firstBad = box;
    });
    if (firstBad) firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return !firstBad;
  }

  // 説明文の URL だけをリンクにする（それ以外は文字として表示）
  function linkify(text) {
    return String(text).split(/(https?:\/\/[^\s]+)/g).map(function (part, i) {
      return i % 2 ? h('a', { href: part, target: '_blank', rel: 'noopener', text: part }) : part;
    }).filter(function (p) { return p !== ''; });
  }

  function renderForm() {
    var draft = loadDraft();
    var errBox = h('p', { class: 'form-error', hidden: true });
    var submit = h('button', { type: 'submit', class: 'btn primary block', text: '回答を送信する' });
    var form = h('form', { novalidate: true }, [
      survey.description ? h('p', { class: 'desc' }, linkify(survey.description)) : null
    ].concat(survey.questions.map(function (q, i) {
      var group = isGroup(q);
      var label = h(group ? 'div' : 'label', { class: 'qtext', for: group ? null : 'q_' + q.question_id }, [
        h('span', { class: 'num', text: 'Q' + (i + 1) + '.' }), q.text, q.required ? h('span', { class: 'req', text: '必須' }) : null
      ]);
      return h('div', { class: 'q', 'data-q': q.question_id }, [
        label,
        q.help_text ? h('p', { class: 'help', text: q.help_text }) : null,
        inputFor(q, draft[q.question_id]),
        h('div', { class: 'err', hidden: true })
      ]);
    })).concat([errBox, submit]));

    form.addEventListener('input', function (e) {
      saveDraft(readValues(form));
      var box = e.target.closest('.q');
      if (box && box.classList.contains('invalid')) {
        box.classList.remove('invalid');
        box.querySelector('.err').hidden = true;
      }
    });
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errBox.hidden = true;
      var values = readValues(form);
      if (!validate(form, values)) return;
      submit.disabled = true;
      submit.textContent = '送信中…';
      try {
        var r = await api.call('submit', { survey_id: survey.survey_id, answers: values });
        clearDraft();
        renderThanks(r.mailed);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        submit.disabled = false;
        submit.textContent = '回答を送信する';
      }
    });
    show(form);
  }

  function renderThanks(mailed) {
    window.scrollTo(0, 0);
    show(h('div', { class: 'notice' }, [
      h('h2', { text: 'ありがとうございました' }),
      h('p', { text: 'ご回答を受け付けました。' }),
      mailed ? h('p', { text: '回答内容の控えをメールでお送りしました。' }) : null
    ]));
  }

  async function init() {
    if (!surveyId) { show(notice('アンケートが指定されていません', 'URLをご確認ください。')); return; }
    try {
      survey = await api.call('getSurvey', { survey_id: surveyId });
    } catch (err) {
      show(notice('読み込めませんでした', err.message));
      return;
    }
    document.getElementById('title').textContent = survey.title;
    document.title = survey.title + '｜漢の福袋';
    if (survey.community) document.getElementById('community').textContent = survey.community;
    if (survey.status !== 'published') {
      show(notice(survey.status === 'closed' ? '受付は終了しました' : '準備中です',
        survey.status === 'closed' ? 'ご協力ありがとうございました。' : '公開までしばらくお待ちください。'));
      return;
    }
    renderForm();
  }
  init();
})();
