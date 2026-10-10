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

  function inputFor(q, value) {
    var name = 'q_' + q.question_id;
    if (q.type === 'textarea') return h('textarea', { id: name, name: name, value: value || '' });
    if (q.type === 'choice') {
      return h('div', { class: 'choices', role: 'radiogroup' }, q.choices.map(function (c) {
        return h('label', { class: 'choice' }, [
          h('input', { type: 'radio', name: name, value: c, checked: value === c }), h('span', { text: c })
        ]);
      }));
    }
    if (q.type === 'scale') {
      var nums = [];
      for (var i = 1; i <= 10; i++) nums.push(i);
      return h('div', {}, [
        h('div', { class: 'scale', role: 'radiogroup' }, nums.map(function (n) {
          return h('label', {}, [
            h('input', { type: 'radio', name: name, value: String(n), checked: String(value) === String(n), 'aria-label': String(n) }),
            h('span', { text: String(n) })
          ]);
        })),
        h('div', { class: 'scale-ends' }, [h('span', { text: '1 低い' }), h('span', { text: '10 高い' })])
      ]);
    }
    var type = q.type === 'email' ? 'email' : 'text';
    var attrs = { id: name, name: name, type: type, value: value || '' };
    if (q.type === 'email') { attrs.autocomplete = 'email'; attrs.inputmode = 'email'; }
    if (q.type === 'name') attrs.autocomplete = 'name';
    return h('input', attrs);
  }

  function readValues(form) {
    var fd = new FormData(form), out = {};
    survey.questions.forEach(function (q) { out[q.question_id] = String(fd.get('q_' + q.question_id) || '').trim(); });
    return out;
  }

  function validate(form, values) {
    var firstBad = null;
    survey.questions.forEach(function (q) {
      var box = form.querySelector('[data-q="' + q.question_id + '"]');
      var msg = '';
      var v = values[q.question_id];
      if (q.required && !v) msg = 'この項目は必須です';
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

  function renderForm() {
    var draft = loadDraft();
    var errBox = h('p', { class: 'form-error', hidden: true });
    var submit = h('button', { type: 'submit', class: 'btn primary block', text: '回答を送信する' });
    var form = h('form', { novalidate: true }, [
      survey.description ? h('p', { class: 'desc', text: survey.description }) : null
    ].concat(survey.questions.map(function (q, i) {
      var isGroup = q.type === 'choice' || q.type === 'scale';
      var label = h(isGroup ? 'div' : 'label', { class: 'qtext', for: isGroup ? null : 'q_' + q.question_id }, [
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
