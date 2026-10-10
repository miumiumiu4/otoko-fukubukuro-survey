(function () {
  var api = window.SurveyApi, h = api.h, fmt = api.fmtDate;
  var root = document.getElementById('root');
  var KEY_STORE = 'ofs-admin-key';
  var TYPE_LABELS = { text: '1行テキスト', textarea: '複数行テキスト', choice: '選択肢（1つ選ぶ）', scale: '10段階評価', email: 'メールアドレス', name: '名前' };
  var STATUS_LABELS = { draft: '下書き', published: '公開中', closed: '停止中' };
  var state = { key: '', labels: {}, tab: 'surveys', surveys: [] };

  /* ---------- 共通 ---------- */
  function call(action, params) {
    return api.call(action, Object.assign({ adminKey: state.key }, params || {}));
  }
  function toast(msg, isError) {
    var t = h('div', { class: 'toast' + (isError ? ' error' : ''), role: 'status', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, isError ? 6000 : 2500);
  }
  async function run(fn) {
    try { return await fn(); } catch (e) {
      toast(e.message, true);
      if (/管理者キー/.test(e.message)) logout();
    }
  }
  // replaceChildren は null を文字 "null" として出してしまうので取り除く
  function fill(el) { el.replaceChildren.apply(el, [].slice.call(arguments, 1).filter(function (n) { return n !== null && n !== undefined && n !== false; })); }
  function loading() { return h('div', { class: 'spinner' }); }
  function surveyUrl(id) { return new URL('./?s=' + encodeURIComponent(id), location.href).href; }
  function copy(text) {
    navigator.clipboard.writeText(text).then(function () { toast('コピーしました'); }, function () { prompt('コピーしてください', text); });
  }
  function labelName(l) { return state.labels[l] || l || ''; }
  function list(s) { return String(s || '').split(/\s*\|\s*/).filter(Boolean); }

  /* ---------- ログイン ---------- */
  function logout() {
    try { sessionStorage.removeItem(KEY_STORE); } catch (e) {}
    state.key = '';
    renderLogin();
  }
  function renderLogin(msg) {
    var input = h('input', { type: 'password', placeholder: '管理者キー', autocomplete: 'current-password', required: true });
    var err = h('p', { class: 'form-error', text: msg || '', hidden: !msg });
    var form = h('form', {}, [input, h('button', { class: 'btn primary block', type: 'submit', text: '入る' }), err]);
    form.addEventListener('submit', function (e) { e.preventDefault(); login(input.value.trim()); });
    root.replaceChildren(h('div', { class: 'login' }, [
      h('div', { class: 'brand' }, [h('div', { class: 'kanji', text: '漢' }), h('div', { class: 'community', text: '漢の福袋' }),
        h('h1', { class: 'title', text: 'アンケート管理' })]),
      form
    ]));
    input.focus();
  }
  async function login(key) {
    state.key = key;
    root.replaceChildren(loading());
    try {
      var meta = await call('ping');
      state.labels = meta.labels;
      try { sessionStorage.setItem(KEY_STORE, key); } catch (e) {}
      renderShell();
    } catch (e) {
      state.key = '';
      renderLogin(e.message);
    }
  }

  /* ---------- 枠 ---------- */
  var TABS = [['surveys', 'アンケート'], ['responses', '回答一覧'], ['people', '人別'], ['dashboard', 'AI分析'], ['tags', 'タグ']];
  var main;
  function renderShell() {
    main = h('main', { class: 'admin-main' });
    var tabs = h('nav', { class: 'tabs' }, TABS.map(function (t) {
      return h('button', { type: 'button', 'data-tab': t[0], text: t[1], onclick: function () { go(t[0]); } });
    }));
    root.replaceChildren(
      h('header', { class: 'admin-head' }, [h('span', { class: 'logo', text: '漢の福袋 アンケート' }), tabs,
        h('button', { class: 'btn small', type: 'button', text: 'ログアウト', onclick: logout })]),
      main
    );
    go(state.tab);
  }
  function go(tab, arg) {
    state.tab = tab;
    root.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    fill(main, loading());
    window.scrollTo(0, 0);
    ({ surveys: viewSurveys, responses: viewResponses, people: viewPeople, dashboard: viewDashboard,
      tags: viewTags, edit: viewEditor, person: viewPerson })[tab](arg);
  }
  async function loadSurveys() {
    state.surveys = await call('listSurveys');
    return state.surveys;
  }
  function surveySelect(selected, includeAll, onchange) {
    var sel = h('select', { onchange: function () { onchange(sel.value); } },
      (includeAll ? [h('option', { value: '', text: 'すべてのアンケート' })] : []).concat(state.surveys.map(function (s) {
        return h('option', { value: s.survey_id, text: s.title + '（' + s.response_count + '件）', selected: s.survey_id === selected });
      })));
    sel.style.maxWidth = '420px';
    return sel;
  }

  /* ---------- アンケート一覧 ---------- */
  async function viewSurveys() {
    var surveys = await run(loadSurveys);
    if (!surveys) return;
    var items = surveys.map(function (s) {
      var statusBtns = [];
      if (s.status !== 'published') statusBtns.push(h('button', { class: 'btn small', text: '公開する', onclick: function () { setStatus(s, 'published'); } }));
      if (s.status === 'published') statusBtns.push(h('button', { class: 'btn small danger', text: '停止する', onclick: function () { setStatus(s, 'closed'); } }));
      if (s.status === 'closed') statusBtns.push(h('button', { class: 'btn small', text: '下書きに戻す', onclick: function () { setStatus(s, 'draft'); } }));
      return h('div', { class: 'card' }, [
        h('div', { class: 'row between' }, [
          h('div', {}, [h('strong', { text: s.title }), ' ', h('span', { class: 'badge ' + s.status, text: STATUS_LABELS[s.status] || s.status })]),
          h('span', { class: 'muted small', text: '回答 ' + s.response_count + '件 ・ 作成 ' + fmt(s.created_at) })
        ]),
        h('p', { class: 'muted small', text: surveyUrl(s.survey_id) }),
        h('div', { class: 'row' }, [
          h('button', { class: 'btn small', text: '編集', onclick: function () { go('edit', s.survey_id); } }),
          h('button', { class: 'btn small', text: '複製', onclick: function () { duplicate(s); } })
        ].concat(statusBtns).concat([
          h('button', { class: 'btn small', text: 'URLをコピー', onclick: function () { copy(surveyUrl(s.survey_id)); } }),
          h('a', { class: 'btn small', href: surveyUrl(s.survey_id), target: '_blank', rel: 'noopener', text: '回答ページを開く' }),
          h('button', { class: 'btn small', text: '回答を見る', onclick: function () { go('responses', s.survey_id); } })
        ]))
      ]);
    });
    fill(main, 
      h('div', { class: 'row between' }, [h('h2', { text: 'アンケート' }),
        h('button', { class: 'btn primary', text: '＋ 新規作成', onclick: function () { go('edit', null); } })]),
      items.length ? h('div', {}, items) : h('p', { class: 'muted', text: 'まだアンケートがありません。' })
    );
  }
  async function setStatus(s, status) {
    if (status === 'closed' && !confirm('「' + s.title + '」の受付を停止しますか？')) return;
    await run(async function () { await call('setStatus', { survey_id: s.survey_id, status: status }); toast(STATUS_LABELS[status] + 'にしました'); go('surveys'); });
  }
  async function duplicate(s) {
    await run(async function () { var r = await call('duplicateSurvey', { survey_id: s.survey_id }); toast('複製しました（下書き）'); go('edit', r.survey_id); });
  }

  /* ---------- アンケート編集 ---------- */
  async function viewEditor(surveyId) {
    var data = { title: '', description: '', community: '漢の福袋', questions: [
      { text: 'お名前', type: 'name', required: true, meaning_label: 'name' },
      { text: 'メールアドレス', help_text: '回答の控えをお送りします', type: 'email', required: true, meaning_label: 'email' }
    ] };
    if (surveyId) {
      data = await run(function () { return call('getSurveyFull', { survey_id: surveyId }); });
      if (!data) return;
    }
    var title = h('input', { type: 'text', value: data.title, placeholder: '例：2026年秋 合宿アンケート' });
    var community = h('input', { type: 'text', value: data.community || '漢の福袋' });
    var desc = h('textarea', { value: data.description || '', placeholder: '回答者へのひと言（任意）' });
    desc.style.minHeight = '80px';
    var qWrap = h('div');
    var questions = data.questions.map(function (q) { return Object.assign({}, q, { choices: [].concat(q.choices || []) }); });

    function renderQuestions() {
      qWrap.replaceChildren.apply(qWrap, questions.map(function (q, i) {
        var text = h('input', { type: 'text', value: q.text, placeholder: '質問文', oninput: function () { q.text = text.value; } });
        var help = h('input', { type: 'text', value: q.help_text || '', placeholder: '補足説明（任意）', oninput: function () { q.help_text = help.value; } });
        var type = h('select', { onchange: function () {
          q.type = type.value;
          if (q.type === 'email') q.meaning_label = 'email';
          if (q.type === 'name') q.meaning_label = 'name';
          renderQuestions();
        } }, Object.keys(TYPE_LABELS).map(function (t) { return h('option', { value: t, text: TYPE_LABELS[t], selected: q.type === t }); }));
        var label = h('select', { onchange: function () { q.meaning_label = label.value; } },
          Object.keys(state.labels).map(function (l) {
            return h('option', { value: l, text: l + '：' + state.labels[l], selected: (q.meaning_label || 'other') === l });
          }));
        var req = h('input', { type: 'checkbox', checked: !!q.required, onchange: function () { q.required = req.checked; } });
        var choices = h('textarea', { value: (q.choices || []).join('\n'), placeholder: '選択肢を1行に1つ',
          oninput: function () { q.choices = choices.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); } });
        choices.style.minHeight = '90px';
        function move(d) {
          var j = i + d;
          if (j < 0 || j >= questions.length) return;
          var t = questions[i]; questions[i] = questions[j]; questions[j] = t;
          renderQuestions();
        }
        return h('div', { class: 'qedit' }, [
          h('div', { class: 'row between' }, [
            h('strong', { class: 'small', text: 'Q' + (i + 1) }),
            h('div', { class: 'row' }, [
              h('button', { class: 'btn small', type: 'button', text: '↑', 'aria-label': '上へ', onclick: function () { move(-1); } }),
              h('button', { class: 'btn small', type: 'button', text: '↓', 'aria-label': '下へ', onclick: function () { move(1); } }),
              h('button', { class: 'btn small danger', type: 'button', text: '削除', onclick: function () {
                if (q.question_id && !confirm('この質問を削除しますか？（過去の回答データは残ります）')) return;
                questions.splice(i, 1); renderQuestions();
              } })
            ])
          ]),
          h('div', { class: 'fields' }, [
            h('div', {}, [h('span', { class: 'field-label', text: '質問文' }), text]),
            h('div', {}, [h('span', { class: 'field-label', text: '回答の形式' }), type]),
            h('div', {}, [h('span', { class: 'field-label', text: '意味ラベル（AI分析用）' }), label]),
            h('div', { class: 'full' }, [h('span', { class: 'field-label', text: '補足説明' }), help]),
            q.type === 'choice' ? h('div', { class: 'full' }, [h('span', { class: 'field-label', text: '選択肢' }), choices]) : null,
            h('label', { class: 'check small' }, [req, '必須'])
          ])
        ]);
      }));
    }
    renderQuestions();

    var saveBtn = h('button', { class: 'btn primary', type: 'button', text: '保存する', onclick: async function () {
      saveBtn.disabled = true;
      await run(async function () {
        var r = await call('saveSurvey', { survey: { survey_id: surveyId || '', title: title.value, community: community.value,
          description: desc.value, questions: questions } });
        toast('保存しました');
        go('edit', r.survey_id);
      });
      saveBtn.disabled = false;
    } });

    fill(main, 
      h('div', { class: 'row between' }, [
        h('h2', { text: surveyId ? 'アンケートを編集' : 'アンケートを新規作成' }),
        h('button', { class: 'btn small', type: 'button', text: '← 一覧へ', onclick: function () { go('surveys'); } })
      ]),
      surveyId ? h('p', { class: 'muted small' }, ['回答URL：', h('a', { href: surveyUrl(surveyId), target: '_blank', rel: 'noopener', text: surveyUrl(surveyId) }),
        '（状態：' + (STATUS_LABELS[data.status] || data.status) + '）']) : null,
      h('div', { class: 'card' }, [
        h('div', { class: 'fields', style: 'display:grid;gap:10px' }, [
          h('div', {}, [h('span', { class: 'field-label', text: 'タイトル' }), title]),
          h('div', {}, [h('span', { class: 'field-label', text: 'コミュニティ名' }), community]),
          h('div', {}, [h('span', { class: 'field-label', text: '説明文' }), desc])
        ])
      ]),
      h('h3', { text: '質問' }),
      h('p', { class: 'muted small', text: '「意味ラベル」は、どのアンケートでも共通の分類です。AIはこれを手がかりに、人をまたいで悩み・変化・成果を集計します。' }),
      qWrap,
      h('div', { class: 'row', style: 'margin:12px 0 24px' }, [
        h('button', { class: 'btn', type: 'button', text: '＋ 質問を追加', onclick: function () {
          questions.push({ text: '', type: 'textarea', required: false, meaning_label: 'other', choices: [] });
          renderQuestions();
        } })
      ]),
      h('div', { class: 'row' }, [saveBtn,
        h('span', { class: 'muted small', text: '新規作成したアンケートは「下書き」です。一覧で「公開する」を押すと回答を受け付けます。' })])
    );
  }

  /* ---------- 回答一覧 ---------- */
  async function viewResponses(surveyId) {
    if (!(await run(loadSurveys))) { if (!state.surveys.length) fill(main, h('p', { class: 'muted', text: 'アンケートがありません。' })); return; }
    surveyId = surveyId || (state.surveys[0] && state.surveys[0].survey_id);
    if (!surveyId) { fill(main, h('p', { class: 'muted', text: 'アンケートがありません。' })); return; }
    var body = h('div', {}, [loading()]);
    var exportAllBtn = h('button', { class: 'btn small', type: 'button', text: '全アンケートを縦持ちCSVで出力', onclick: exportLongCsv });
    fill(main, 
      h('h2', { text: '回答一覧' }),
      h('div', { class: 'row', style: 'margin-bottom:14px' }, [surveySelect(surveyId, false, function (v) { go('responses', v); }), exportAllBtn]),
      body
    );
    var data = await run(function () { return call('listResponses', { survey_id: surveyId }); });
    if (!data) return;
    var qs = data.questions;
    var survey = state.surveys.filter(function (s) { return s.survey_id === surveyId; })[0] || {};
    var csvBtn = h('button', { class: 'btn small primary', type: 'button', text: 'このアンケートをCSVで出力', onclick: function () {
      var header = ['response_id', 'submitted_at', 'respondent_id'].concat(qs.map(function (q) { return q.text; }))
        .concat(['AI要約', '悩みタグ', '変化タグ', '成果', '紹介文に使える一言']);
      var rows = data.responses.map(function (r) {
        var by = {};
        r.answers.forEach(function (a) { by[a.question_id] = a.answer; });
        var ai = r.ai || {};
        return [r.response_id, r.submitted_at, r.respondent_id].concat(qs.map(function (q) { return by[q.question_id] || ''; }))
          .concat([ai.summary || '', ai.pain_tags || '', ai.change_tags || '', ai.outcome_numbers || '', ai.best_quote || '']);
      });
      downloadCsv((survey.title || surveyId) + '.csv', [header].concat(rows));
    } });
    var shownQs = qs.filter(function (q) { return q.type !== 'email' && q.type !== 'name'; }).slice(0, 3);
    var table = h('table', {}, [
      h('thead', {}, h('tr', {}, [h('th', { text: '日時' }), h('th', { text: '名前' }), h('th', { text: 'AI' })]
        .concat(shownQs.map(function (q) { return h('th', { text: q.text.slice(0, 16) }); })))),
      h('tbody', {}, data.responses.map(function (r) {
        var by = {};
        r.answers.forEach(function (a) { by[a.question_id] = a.answer; });
        var detail = h('tr', { hidden: true }, h('td', { colspan: String(3 + shownQs.length) }, responseDetail(r)));
        var tr = h('tr', { class: 'clickable', onclick: function () { detail.hidden = !detail.hidden; } },
          [h('td', { text: fmt(r.submitted_at) }), h('td', { text: r.name || '—' }), h('td', { text: r.ai ? '済' : '未' })]
            .concat(shownQs.map(function (q) { return h('td', { text: String(by[q.question_id] || '').slice(0, 40) }); })));
        return [tr, detail];
      }).flat())
    ]);
    body.replaceChildren(
      h('div', { class: 'row between', style: 'margin-bottom:10px' }, [h('span', { class: 'muted', text: data.responses.length + '件（行をクリックで詳細）' }), csvBtn]),
      data.responses.length ? h('div', { class: 'table-wrap card' }, table) : h('p', { class: 'muted', text: 'まだ回答がありません。' })
    );
  }

  function responseDetail(r) {
    var ai = r.ai;
    return h('div', {}, [
      h('p', { class: 'muted small' }, [r.survey_title ? r.survey_title + ' ・ ' : '', fmt(r.submitted_at), r.email ? ' ・ ' + r.email : '']),
      h('dl', { class: 'answer-list' }, r.answers.map(function (a) {
        return [h('dt', { text: (a.question_text || a.question_id) + '（' + labelName(a.meaning_label) + '）' }), h('dd', { text: a.answer || '—' })];
      }).flat()),
      ai ? h('div', { class: 'ai-box' }, [
        h('div', { text: 'AI要約：' + ai.summary }),
        ai.before_state || ai.after_state ? h('div', { class: 'muted', text: 'Before：' + (ai.before_state || '—') + ' → After：' + (ai.after_state || '—') }) : null,
        h('div', {}, list(ai.pain_tags).map(function (t) { return h('span', { class: 'tag', text: t }); })
          .concat(list(ai.change_tags).map(function (t) { return h('span', { class: 'tag change', text: t }); }))),
        ai.outcome_numbers ? h('div', { text: '成果：' + list(ai.outcome_numbers).join('、') }) : null,
        ai.best_quote ? h('div', { class: 'quote' }, h('span', { class: 't', text: '「' + ai.best_quote + '」' })) : null
      ]) : h('div', { class: 'ai-box muted' }, [
        'AI分析はまだです。 ',
        h('button', { class: 'btn small', type: 'button', text: '今すぐ分析', onclick: async function (e) {
          e.stopPropagation();
          e.target.disabled = true;
          var res = await run(function () { return call('analyzeResponse', { response_id: r.response_id }); });
          if (res) { toast('分析しました'); r.ai = res; e.target.closest('td').replaceChildren(responseDetail(r)); }
          else e.target.disabled = false;
        } })
      ])
    ]);
  }

  async function exportLongCsv() {
    var data = await run(function () { return call('listResponses', {}); });
    if (!data) return;
    var rows = [['response_id', 'survey_id', 'survey_title', 'submitted_at', 'respondent_id', 'name', 'question_id', 'question_text', 'meaning_label', 'answer']];
    data.responses.forEach(function (r) {
      r.answers.forEach(function (a) {
        rows.push([r.response_id, r.survey_id, r.survey_title, r.submitted_at, r.respondent_id, r.name, a.question_id, a.question_text, a.meaning_label, a.answer]);
      });
    });
    downloadCsv('all_answers_long.csv', rows);
  }

  function downloadCsv(filename, rows) {
    var csv = rows.map(function (row) {
      return row.map(function (v) {
        var s = String(v === undefined || v === null ? '' : v);
        if (/^[=+\-@]/.test(s)) s = "'" + s; // Excel の数式インジェクション対策
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var a = h('a', { href: URL.createObjectURL(blob), download: filename.replace(/[\\/:*?"<>|]/g, '_') });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- 人別 ---------- */
  async function viewPeople() {
    var people = await run(function () { return call('listRespondents'); });
    if (!people) return;
    var q = h('input', { type: 'search', placeholder: '名前・メールで絞り込み' });
    q.style.maxWidth = '320px';
    var tbody = h('tbody');
    function draw() {
      var kw = q.value.trim().toLowerCase();
      tbody.replaceChildren.apply(tbody, people.filter(function (p) {
        return !kw || String(p.name).toLowerCase().indexOf(kw) >= 0 || String(p.email).toLowerCase().indexOf(kw) >= 0;
      }).map(function (p) {
        return h('tr', { class: 'clickable', onclick: function () { go('person', p); } }, [
          h('td', { text: p.name || '—' }), h('td', { text: p.email }), h('td', { text: String(p.survey_count) }),
          h('td', { text: fmt(p.first_seen) }), h('td', { text: fmt(p.last_seen) })
        ]);
      }));
    }
    q.addEventListener('input', draw);
    draw();
    fill(main, 
      h('h2', { text: '人別（回答者 ' + people.length + '人）' }),
      h('div', { class: 'row', style: 'margin-bottom:12px' }, [q]),
      h('div', { class: 'table-wrap card' }, h('table', {}, [
        h('thead', {}, h('tr', {}, ['名前', 'メール', '回答数', '初回', '最終'].map(function (t) { return h('th', { text: t }); }))),
        tbody
      ]))
    );
  }

  async function viewPerson(p) {
    var data = await run(function () { return call('listResponses', { respondent_id: p.respondent_id }); });
    if (!data) return;
    fill(main, 
      h('div', { class: 'row between' }, [
        h('h2', { text: (p.name || '名前なし') + ' さんの回答履歴' }),
        h('button', { class: 'btn small', type: 'button', text: '← 人別へ', onclick: function () { go('people'); } })
      ]),
      h('p', { class: 'muted small', text: (p.email || '') + ' ・ 回答 ' + data.responses.length + '件' }),
      h('div', {}, data.responses.map(function (r) {
        return h('div', { class: 'card' }, [h('h3', { text: r.survey_title }), responseDetail(r)]);
      }))
    );
  }

  /* ---------- AI分析ダッシュボード ---------- */
  async function viewDashboard(surveyId) {
    if (!(await run(loadSurveys))) return;
    surveyId = surveyId || '';
    var d = await run(function () { return call('dashboard', { survey_id: surveyId }); });
    if (!d) return;

    function bars(items, cls) {
      if (!items.length) return h('p', { class: 'muted small', text: 'まだデータがありません。' });
      var max = items[0].count;
      return h('div', {}, items.slice(0, 15).map(function (it) {
        return h('div', { class: 'bar-row ' + (cls || '') }, [
          h('span', { text: it.tag }),
          h('div', {}, h('div', { class: 'bar', style: 'width:' + Math.max(4, Math.round(it.count / max * 100)) + '%' })),
          h('span', { class: 'n', text: String(it.count) })
        ]);
      }));
    }
    function personLink(x) {
      return h('a', { href: '#', text: x.name, onclick: function (e) {
        e.preventDefault();
        go('person', { respondent_id: x.respondent_id, name: x.name });
      } });
    }

    var analyzeBtn = h('button', { class: 'btn small primary', type: 'button', text: '未分析をAIで分析（最大5件）', disabled: !d.pending || !d.ai_ready,
      onclick: async function () {
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = '分析中…（1件10〜30秒）';
        var r = await run(function () { return call('analyzePending', { limit: 5 }); });
        if (r) {
          toast(r.analyzed + '件分析しました' + (r.errors.length ? '（エラー' + r.errors.length + '件）' : ''), !!r.errors.length);
          if (r.errors.length) console.warn(r.errors);
        }
        go('dashboard', surveyId);
      } });

    fill(main, 
      h('h2', { text: 'AI分析ダッシュボード' }),
      h('div', { class: 'row', style: 'margin-bottom:14px' }, [surveySelect(surveyId, true, function (v) { go('dashboard', v); }), analyzeBtn]),
      d.ai_ready ? null : h('p', { class: 'form-error', style: 'text-align:left', text: 'AIキー（ANTHROPIC_API_KEY）がGASのスクリプトプロパティに未設定です。設定すると10分ごとに自動で分析されます。' }),
      h('div', { class: 'stats' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'v', text: String(d.total_responses) }), h('div', { class: 'l', text: '回答数' })]),
        h('div', { class: 'stat' }, [h('div', { class: 'v', text: String(d.analyzed) }), h('div', { class: 'l', text: 'AI分析済み' })]),
        h('div', { class: 'stat' }, [h('div', { class: 'v', text: String(d.pending) }), h('div', { class: 'l', text: '未分析（10分ごとに自動）' })])
      ]),
      h('div', { class: 'grid2' }, [
        h('div', { class: 'card' }, [h('h3', { text: '悩みタグ ランキング' }), bars(d.pain_ranking)]),
        h('div', { class: 'card' }, [h('h3', { text: '変化タグ ランキング' }), bars(d.change_ranking, 'change')])
      ]),
      h('div', { class: 'grid2' }, [
        h('div', { class: 'card' }, [h('h3', { text: '成果の数字' }),
          d.outcomes.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, d.outcomes.map(function (o) {
            return h('tr', {}, [h('td', { text: o.text }), h('td', {}, personLink(o)), h('td', { class: 'muted small', text: o.survey_title })]);
          })))) : h('p', { class: 'muted small', text: 'まだデータがありません。' })]),
        h('div', { class: 'card' }, [h('h3', { text: 'こんな人に勧めたい' }), bars(d.recommend_ranking)])
      ]),
      h('div', { class: 'card' }, [h('h3', { text: '紹介文に使える一言' }),
        d.quotes.length ? h('div', {}, d.quotes.map(function (x) {
          return h('div', { class: 'quote' }, [
            h('div', { class: 't', text: '「' + x.text + '」' }),
            h('div', { class: 'w' }, [personLink(x), ' ・ ' + x.survey_title + ' ・ ' + fmt(x.submitted_at) + ' ',
              h('button', { class: 'btn small', type: 'button', text: 'コピー', onclick: function () { copy(x.text); } })])
          ]);
        })) : h('p', { class: 'muted small', text: 'まだデータがありません。' })]),
      h('p', { class: 'muted small', text: '人ごとの回答履歴は「人別」タブ、または名前をクリックして確認できます。紹介文への掲載は、本人の掲載可否の回答を必ず確認してください。' })
    );
  }

  /* ---------- タグ ---------- */
  async function viewTags() {
    var tags = await run(function () { return call('listTags'); });
    if (!tags) return;
    var CAT = { pain: '悩み', change: '変化', outcome: '成果' };
    var tbody = h('tbody');
    function draw() {
      tbody.replaceChildren.apply(tbody, tags.map(function (t, i) {
        var name = h('input', { type: 'text', value: t.tag, oninput: function () { t.tag = name.value; } });
        var cat = h('select', { onchange: function () { t.category = cat.value; } }, Object.keys(CAT).map(function (c) {
          return h('option', { value: c, text: CAT[c], selected: t.category === c });
        }));
        var desc = h('input', { type: 'text', value: t.description, oninput: function () { t.description = desc.value; } });
        return h('tr', {}, [h('td', {}, name), h('td', {}, cat), h('td', {}, desc),
          h('td', {}, h('button', { class: 'btn small danger', type: 'button', text: '削除', onclick: function () { tags.splice(i, 1); draw(); } }))]);
      }));
    }
    draw();
    fill(main, 
      h('h2', { text: 'タグ辞書' }),
      h('p', { class: 'muted small', text: 'AIはここにあるタグを優先して使います（表記ゆれ防止）。似たタグを1つにまとめると集計がきれいになります。新しいタグはAIが自動で追加します。' }),
      h('div', { class: 'table-wrap card' }, h('table', {}, [
        h('thead', {}, h('tr', {}, ['タグ', '分類', '説明', ''].map(function (t) { return h('th', { text: t }); }))), tbody
      ])),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn', type: 'button', text: '＋ タグを追加', onclick: function () { tags.push({ tag: '', category: 'pain', description: '' }); draw(); } }),
        h('button', { class: 'btn primary', type: 'button', text: '保存する', onclick: async function () {
          await run(async function () { var r = await call('saveTags', { tags: tags }); toast(r.count + '件のタグを保存しました'); go('tags'); });
        } })
      ])
    );
  }

  /* ---------- 起動 ---------- */
  var saved = '';
  try { saved = sessionStorage.getItem(KEY_STORE) || ''; } catch (e) {}
  if (saved) login(saved); else renderLogin();
})();
