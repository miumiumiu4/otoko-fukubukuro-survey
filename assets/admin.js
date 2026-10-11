(function () {
  var api = window.SurveyApi, h = api.h, fmt = api.fmtDate;
  var root = document.getElementById('root');
  var KEY_STORE = 'ofs-admin-key';
  // Google フォームの形式に合わせた並び
  var TYPE_LABELS = { text: '記述式（1行）', textarea: '段落（複数行）', choice: 'ラジオボタン（1つ選ぶ）',
    checkbox: 'チェックボックス（複数選べる）', dropdown: 'プルダウン', scale: '均等目盛（数字で評価）',
    date: '日付', time: '時刻', email: 'メールアドレス', name: '名前' };
  var CHOICE_TYPES = { choice: true, checkbox: true, dropdown: true };
  var STATUS_LABELS = { draft: '下書き', published: '公開中', closed: '停止中' };
  var state = { key: '', labels: {}, tab: 'surveys', surveys: [], user: null };
  // 権限：viewer（閲覧専用）< editor（編集できる）< owner（オーナー。鍵の管理もできる）
  var ROLE_RANK = { viewer: 1, editor: 2, owner: 3 };
  var ROLE_LABELS = { owner: 'オーナー', editor: '編集できる', viewer: '閲覧専用' };
  function can(role) { return ROLE_RANK[(state.user || {}).role] >= ROLE_RANK[role]; }

  /* ---------- 共通 ---------- */
  // GAS（スプレッドシート）への問い合わせは1回1〜数秒かかり、スマホでは同時に何本も送ると詰まる。
  // そこで「まとめ取り（snapshot）」1回で全データを手元に持ち、各画面はそこから作る（通信なし）。
  // 30秒以上たっていたら、表示はそのままで裏で取り直し、変わっていれば静かに描き直す。
  // まとめ取りに対応していない古い GAS のときは、画面ごとに問い合わせる方式に戻る。
  var READ_ACTIONS = { ping: 1, listSurveys: 1, getSurveyFull: 1, listResponses: 1, listRespondents: 1, dashboard: 1, listTags: 1, listKeys: 1 };
  var FRESH_MS = 30000;
  var SNAP_STORE = 'ofs-admin-snapshot';
  var cache = {};
  var snap = null, snapAt = 0, snapPending = null, snapSupported = true;
  function fetchApi(action, params) {
    return api.call(action, Object.assign({ adminKey: state.key }, params || {}));
  }
  function cacheKey(action, params) { return action + ':' + JSON.stringify(params || {}); }
  function clearCache() {
    cache = {}; snap = null; snapAt = 0;
    try { sessionStorage.removeItem(SNAP_STORE); } catch (e) {}
  }
  // 再読み込み（スマホでよく起きる）でもすぐ表示できるよう、このタブの中だけに覚えておく
  function restoreSnapshot() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(SNAP_STORE) || 'null');
      if (saved && saved.key === state.key) { snap = saved.data; snapAt = 0; }
    } catch (e) {}
  }
  function loadSnapshot() {
    if (snapPending) return snapPending;
    snapPending = fetchApi('snapshot').then(function (data) {
      snap = data; snapAt = Date.now(); snapPending = null;
      try { sessionStorage.setItem(SNAP_STORE, JSON.stringify({ key: state.key, data: data })); } catch (e) {}
      return data;
    }, function (e) {
      snapPending = null;
      if (/不明な操作/.test(e.message)) snapSupported = false;
      // 鍵が停止された・違う場合は、手元に残ったデータを見せ続けない
      if (/管理者キー/.test(e.message) && state.user) logout();
      throw e;
    });
    return snapPending;
  }

  function rank(m) {
    return Object.keys(m).map(function (k) { return { tag: k, count: m[k] }; })
      .sort(function (a, b) { return b.count - a.count || a.tag.localeCompare(b.tag); });
  }
  // まとめ取りしたデータから、各画面が欲しい形を作る（GAS の各 api と同じ形）
  function derive(action, p) {
    p = p || {};
    var S = snap;
    if (action === 'ping') return { labels: S.labels, types: S.types, user: S.user, roles: S.roles };
    if (action === 'listSurveys') return S.surveys;
    if (action === 'listRespondents') return S.respondents;
    if (action === 'listTags') return S.tags;
    if (action === 'listKeys') {
      if (!S.keys) throw new Error('この操作をする権限がありません。');
      return S.keys;
    }
    if (action === 'getSurveyFull') {
      var sv = S.surveys.filter(function (x) { return x.survey_id === p.survey_id; })[0];
      if (!sv) throw new Error('アンケートが見つかりません。');
      return Object.assign({}, sv, { questions: S.questions[p.survey_id] || [] });
    }
    if (action === 'listResponses') {
      return {
        questions: p.survey_id ? (S.questions[p.survey_id] || []) : [],
        responses: S.responses.filter(function (r) {
          return (!p.survey_id || r.survey_id === p.survey_id) && (!p.respondent_id || r.respondent_id === p.respondent_id);
        })
      };
    }
    if (action === 'dashboard') {
      var rs = S.responses.filter(function (r) { return !p.survey_id || r.survey_id === p.survey_id; });
      var pain = {}, change = {}, targets = {}, outcomes = [], quotes = [], analyzed = 0;
      rs.forEach(function (r) {
        var a = r.ai;
        if (!a) return;
        analyzed++;
        var meta = { response_id: r.response_id, name: r.name || '（名前なし）', survey_title: r.survey_title,
          submitted_at: r.submitted_at, respondent_id: r.respondent_id };
        list(a.pain_tags).forEach(function (t) { pain[t] = (pain[t] || 0) + 1; });
        list(a.change_tags).forEach(function (t) { change[t] = (change[t] || 0) + 1; });
        list(a.recommend_target).forEach(function (t) { targets[t] = (targets[t] || 0) + 1; });
        list(a.outcome_numbers).forEach(function (o) { outcomes.push(Object.assign({ text: o }, meta)); });
        if (a.best_quote) quotes.push(Object.assign({ text: a.best_quote, summary: a.summary }, meta));
      });
      return { total_responses: rs.length, analyzed: analyzed, pending: rs.length - analyzed,
        pain_ranking: rank(pain), change_ranking: rank(change), recommend_ranking: rank(targets),
        outcomes: outcomes, quotes: quotes };
    }
    throw new Error('不明な操作です: ' + action);
  }

  function call(action, params) {
    if (!READ_ACTIONS[action]) {
      // 書き込みのあとは、手元のデータが古くなるので捨てて、裏で取り直す
      return fetchApi(action, params).then(function (r) { clearCache(); prefetch(); return r; });
    }
    if (snapSupported) {
      if (!snap) {
        return loadSnapshot().then(function () { return derive(action, params); }, function (e) {
          if (!snapSupported) return cachedCall(action, params);
          throw e;
        });
      }
      if (Date.now() - snapAt > FRESH_MS && !snapPending) refreshSnapshot();
      try { return Promise.resolve(derive(action, params)); } catch (e) { return Promise.reject(e); }
    }
    return cachedCall(action, params);
  }
  function refreshSnapshot() {
    var before = JSON.stringify(snap), tab = state.tab, arg = state.arg;
    loadSnapshot().then(function (data) {
      // 見ている画面が同じで、中身が変わっていたら静かに描き直す（編集中の画面は描き直さない）
      if (JSON.stringify(data) !== before && state.tab === tab && state.arg === arg && tab !== 'edit' && tab !== 'templates') go(tab, arg, true);
    }, function () {});
  }

  // 古い GAS 用：画面ごとに問い合わせ、結果を覚えておく
  function cachedCall(action, params) {
    if (action === 'listResponses' && params && params.respondent_id && !params.survey_id) {
      var all = cache[cacheKey('listResponses', {})];
      if (all && all.data) {
        return Promise.resolve({ questions: [], responses: all.data.responses.filter(function (r) { return r.respondent_id === params.respondent_id; }) });
      }
    }
    var key = cacheKey(action, params), hit = cache[key];
    if (hit && hit.data) {
      if (Date.now() - hit.at > FRESH_MS && !hit.refreshing) refresh(key, action, params);
      return Promise.resolve(hit.data);
    }
    if (hit && hit.pending) return hit.pending;
    var pending = fetchApi(action, params).then(function (data) {
      cache[key] = { data: data, at: Date.now() };
      return data;
    }, function (e) { delete cache[key]; throw e; });
    cache[key] = { pending: pending };
    return pending;
  }
  function refresh(key, action, params) {
    var hit = cache[key];
    hit.refreshing = true;
    var tab = state.tab, arg = state.arg;
    fetchApi(action, params).then(function (data) {
      var changed = JSON.stringify(data) !== JSON.stringify(hit.data);
      cache[key] = { data: data, at: Date.now() };
      if (changed && state.tab === tab && state.arg === arg && tab !== 'edit' && tab !== 'templates') go(tab, arg, true);
    }, function () { hit.refreshing = false; });
  }
  // ログイン直後や書き込みのあとに、データを裏で取っておく
  function prefetch() {
    if (snapSupported) { loadSnapshot().catch(function () {}); return; }
    ['listSurveys', 'listRespondents', 'listTags'].forEach(function (a) { cachedCall(a).catch(function () {}); });
    cachedCall('listResponses', {}).catch(function () {});
    cachedCall('dashboard', { survey_id: '' }).catch(function () {});
    if (can('owner')) cachedCall('listKeys').catch(function () {});
    cachedCall('listSurveys').then(function (lst) {
      lst.forEach(function (sv) { cachedCall('listResponses', { survey_id: sv.survey_id }).catch(function () {}); });
    }).catch(function () {});
  }
  function reloadAll() {
    clearCache();
    prefetch();
    go(state.tab, state.arg);
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
  // 今も見ている画面のときだけ描く（読み込み中に別のタブへ移った場合、古い結果で上書きしない）
  function paint(token) {
    if (token !== navSeq) return;
    fill.apply(null, [main].concat([].slice.call(arguments, 1)));
  }
  function loading() { return h('div', { class: 'spinner' }); }
  function surveyUrl(id) { return new URL('./?s=' + encodeURIComponent(id), location.href).href; }
  function copy(text) {
    navigator.clipboard.writeText(text).then(function () { toast('コピーしました'); }, function () { prompt('コピーしてください', text); });
  }
  // AI とのやりとり（お金がかからないように、APIではなく Claude のチャットを使う）
  // ① 依頼文をコピー → ② Claude に貼る → ③ 返ってきた答えを貼り付けて「読み込む」
  function aiExchange(makePrompt, onAnswer, loadLabel) {
    var promptBox = h('textarea', { readonly: true, 'aria-label': '依頼文', style: 'min-height:90px;font-size:12px', hidden: true });
    var copyBtn = h('button', { class: 'btn primary small', type: 'button', text: '① 依頼文をコピー', onclick: function () {
      var text;
      try { text = makePrompt(); } catch (e) { toast(e.message, true); return; }
      promptBox.value = text;
      var shown = function () {
        promptBox.hidden = false; promptBox.focus(); promptBox.select();
        toast('自動でコピーできませんでした。下の枠の文章をすべて選んでコピーしてください。', true);
      };
      try {
        navigator.clipboard.writeText(text).then(function () { toast('依頼文をコピーしました。Claude のチャットに貼ってください。'); }, shown);
      } catch (e) { shown(); }
    } });
    var answer = h('textarea', { placeholder: '③ Claude の答え（```json で始まる部分）をそのまま貼り付け', style: 'min-height:90px' });
    var loadBtn = h('button', { class: 'btn primary small', type: 'button', text: loadLabel || '読み込む', onclick: async function () {
      loadBtn.disabled = true;
      try { await onAnswer(answer.value); } catch (e) { toast(e.message, true); }
      loadBtn.disabled = false;
    } });
    return h('div', { style: 'display:grid;gap:8px;margin-top:10px' }, [
      h('div', { class: 'row' }, [copyBtn,
        h('a', { class: 'btn small', href: 'https://claude.ai/new', target: '_blank', rel: 'noopener', text: '② Claude を開く' })]),
      promptBox, answer, h('div', {}, loadBtn)
    ]);
  }

  function labelName(l) { return state.labels[l] || l || ''; }
  function list(s) { return String(s || '').split(/\s*\|\s*/).filter(Boolean); }

  /* ---------- ログイン ---------- */
  function logout() {
    try { sessionStorage.removeItem(KEY_STORE); } catch (e) {}
    state.key = '';
    state.user = null;
    clearCache();
    state.tab = 'surveys';
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
    restoreSnapshot();
    root.replaceChildren(loading());
    try {
      var meta = await call('ping');
      state.labels = meta.labels;
      // 鍵の仕組みが入る前のGASは user を返さないので、オーナー扱いにする
      state.user = meta.user || { name: 'オーナー', role: 'owner' };
      // 前回のデータで先に表示した場合は、裏で取り直して最新にする
      if (snap && snapAt === 0) refreshSnapshot(); else if (!snap) prefetch();
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
    var tabs = h('nav', { class: 'tabs' }, TABS.concat(can('owner') ? [['keys', '鍵']] : []).map(function (t) {
      return h('button', { type: 'button', 'data-tab': t[0], text: t[1], onclick: function () { go(t[0]); } });
    }));
    root.replaceChildren(
      h('header', { class: 'admin-head' }, [h('span', { class: 'logo', text: '漢の福袋 アンケート' }), tabs,
        h('span', { class: 'muted small', text: state.user.id === 'owner' ? 'オーナー' : state.user.name + '（' + ROLE_LABELS[state.user.role] + '）' }),
        h('button', { class: 'btn small', type: 'button', text: '最新にする', title: 'スプレッドシートから取り直す', onclick: reloadAll }),
        h('button', { class: 'btn small', type: 'button', text: 'ログアウト', onclick: logout })]),
      main
    );
    if (state.tab === 'keys' && !can('owner')) state.tab = 'surveys';
    go(state.tab);
  }
  var navSeq = 0;
  // quiet=true のときは、くるくるを出さずに今の画面を差し替える（裏で取り直したとき用）
  function go(tab, arg, quiet) {
    state.tab = tab;
    state.arg = arg;
    var seq = ++navSeq;
    root.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    var y = window.scrollY;
    if (!quiet) { fill(main, loading()); window.scrollTo(0, 0); }
    var view = ({ surveys: viewSurveys, responses: viewResponses, people: viewPeople, dashboard: viewDashboard,
      tags: viewTags, edit: viewEditor, templates: viewTemplates, keys: viewKeys, person: viewPerson })[tab];
    Promise.resolve(view(arg)).then(function () {
      if (quiet) window.scrollTo(0, y);
      // 読み込みに失敗して、くるくるだけが残った場合は、やり直しボタンを出す
      if (seq === navSeq && main.children.length === 1 && main.firstChild.classList.contains('spinner')) {
        fill(main, h('div', { class: 'notice' }, [
          h('h2', { text: '読み込めませんでした' }),
          h('p', { text: '通信が混み合っているか、スプレッドシートへの接続に時間がかかっています。' }),
          h('button', { class: 'btn primary', type: 'button', text: 'もう一度読み込む', onclick: reloadAll })
        ]));
      }
    });
  }

  async function loadSurveys() {
    state.surveys = await call('listSurveys');
    return state.surveys;
  }
  // 状態ごとにまとめた選択欄（公開中 → 下書き → 停止中の順）
  function surveySelect(selected, includeAll, onchange) {
    var sel = h('select', { onchange: function () { onchange(sel.value); } },
      (includeAll ? [h('option', { value: '', text: 'すべてのアンケート' })] : []).concat(['published', 'draft', 'closed'].map(function (st) {
        var group = state.surveys.filter(function (x) { return x.status === st; });
        if (!group.length) return null;
        return h('optgroup', { label: STATUS_LABELS[st] }, group.map(function (x) {
          return h('option', { value: x.survey_id, text: x.title + '（' + x.response_count + '件）', selected: x.survey_id === selected });
        }));
      })));
    sel.style.maxWidth = '420px';
    return sel;
  }

  /* ---------- アンケート一覧 ---------- */
  // 数が増えても探しやすいように、検索・状態の絞り込み・並べ替えができる一覧にする（選んだ条件はこの端末に覚える）
  var LIST_PREF = 'ofs-survey-list';
  function listPref() {
    try { return Object.assign({ q: '', status: 'active', sort: 'recent' }, JSON.parse(localStorage.getItem(LIST_PREF) || '{}')); }
    catch (e) { return { q: '', status: 'active', sort: 'recent' }; }
  }
  function saveListPref(p) { try { localStorage.setItem(LIST_PREF, JSON.stringify(p)); } catch (e) {} }

  async function viewSurveys() {
    var token = navSeq; // 後から別のタブに移ったら、この画面は描かない
    var surveys = await run(loadSurveys);
    if (!surveys) return;
    // 最終回答日と未分析の数（まとめ取りのデータがあれば計算する）
    var stats = {};
    ((snap && snap.responses) || []).forEach(function (r) {
      var st = stats[r.survey_id] = stats[r.survey_id] || { last: '', pending: 0 };
      if (String(r.submitted_at) > st.last) st.last = r.submitted_at;
      if (!r.ai) st.pending++;
    });
    var pref = listPref();
    var FILTERS = [['active', '公開中・下書き'], ['published', '公開中'], ['draft', '下書き'], ['closed', '停止中'], ['all', 'すべて']];
    var SORTS = { recent: '新しく作った順', activity: '最近回答があった順', responses: '回答が多い順', title: '名前順' };
    function count(f) {
      return surveys.filter(function (x) { return f === 'all' || (f === 'active' ? x.status !== 'closed' : x.status === f); }).length;
    }

    var search = h('input', { type: 'search', id: 'survey-search', value: pref.q, placeholder: 'タイトルで探す' });
    var sortSel = h('select', { id: 'survey-sort' }, Object.keys(SORTS).map(function (k) { return h('option', { value: k, text: SORTS[k], selected: pref.sort === k }); }));
    var chips = h('div', { class: 'chips', role: 'tablist' });
    var listBox = h('div', { class: 'survey-list' });

    function moreMenu(x) {
      var items = [];
      if (can('editor')) {
        items.push(['複製する', function () { duplicate(x); }]);
        if (x.status !== 'published') items.push(['公開する', function () { setStatus(x, 'published'); }]);
        if (x.status === 'published') items.push(['受付を停止する', function () { setStatus(x, 'closed'); }]);
        if (x.status === 'closed') items.push(['下書きに戻す', function () { setStatus(x, 'draft'); }]);
      }
      items.push(['回答URLをコピー', function () { copy(surveyUrl(x.survey_id)); }]);
      items.push(['回答ページを開く', function () { window.open(surveyUrl(x.survey_id), '_blank', 'noopener'); }]);
      items.push(['AI分析を見る', function () { go('dashboard', x.survey_id); }]);
      var menu = h('details', { class: 'more' }, [
        h('summary', { class: 'btn small', 'aria-label': 'その他の操作', text: '…' }),
        h('div', { class: 'more-menu' }, items.map(function (it) {
          return h('button', { type: 'button', text: it[0], onclick: function () { menu.open = false; it[1](); } });
        }))
      ]);
      return menu;
    }

    function draw() {
      pref.q = search.value.trim(); pref.sort = sortSel.value; saveListPref(pref);
      chips.replaceChildren.apply(chips, FILTERS.map(function (f) {
        return h('button', { type: 'button', class: 'chip' + (pref.status === f[0] ? ' on' : ''), role: 'tab',
          text: f[1] + ' ' + count(f[0]), onclick: function () { pref.status = f[0]; draw(); } });
      }));
      var kw = pref.q.toLowerCase();
      var rows = surveys.filter(function (x) {
        if (pref.status === 'active' && x.status === 'closed') return false;
        if (pref.status !== 'active' && pref.status !== 'all' && x.status !== pref.status) return false;
        return !kw || String(x.title).toLowerCase().indexOf(kw) >= 0;
      }).sort(function (a, b) {
        if (pref.sort === 'responses') return b.response_count - a.response_count;
        if (pref.sort === 'title') return String(a.title).localeCompare(String(b.title), 'ja');
        if (pref.sort === 'activity') return String((stats[b.survey_id] || {}).last || '').localeCompare(String((stats[a.survey_id] || {}).last || ''));
        return String(b.created_at).localeCompare(String(a.created_at));
      });
      if (!rows.length) {
        listBox.replaceChildren(h('p', { class: 'muted', text: surveys.length ? '条件に合うアンケートがありません。' : 'まだアンケートがありません。' }));
        return;
      }
      listBox.replaceChildren.apply(listBox, rows.map(function (x) {
        var st = stats[x.survey_id] || {};
        var meta = '回答 ' + x.response_count + '件' + (st.last ? ' ・ 最終回答 ' + fmt(st.last) : '') + ' ・ 作成 ' + fmt(x.created_at).slice(0, 10);
        return h('div', { class: 'srow' }, [
          h('div', { class: 'srow-main', role: 'button', tabindex: '0', onclick: function () { go('responses', x.survey_id); },
            onkeydown: function (e) { if (e.key === 'Enter') go('responses', x.survey_id); } }, [
            h('div', { class: 'srow-title' }, [h('span', { class: 'badge ' + x.status, text: STATUS_LABELS[x.status] || x.status }), ' ', h('strong', { text: x.title })]),
            h('div', { class: 'muted small' }, [meta, st.pending ? h('span', { class: 'pending', text: ' ・ 未分析 ' + st.pending + '件' }) : null])
          ]),
          h('div', { class: 'srow-actions' }, [
            h('button', { class: 'btn small', type: 'button', text: '回答', onclick: function () { go('responses', x.survey_id); } }),
            h('button', { class: 'btn small', type: 'button', text: can('editor') ? '編集' : '質問', onclick: function () { go('edit', x.survey_id); } }),
            moreMenu(x)
          ])
        ]);
      }));
    }
    search.addEventListener('input', draw);
    sortSel.addEventListener('change', draw);
    draw();

    var published = surveys.filter(function (x) { return x.status === 'published'; }).length;
    var totalRes = surveys.reduce(function (n, x) { return n + Number(x.response_count || 0); }, 0);
    var pendingAll = Object.keys(stats).reduce(function (n, k) { return n + stats[k].pending; }, 0);
    paint(token,
      h('div', { class: 'row between' }, [h('h2', { text: 'アンケート' }),
        h('div', { class: 'row' }, [
          can('editor') && (window.SURVEY_TEMPLATES || []).length ? h('button', { class: 'btn', text: 'テンプレートから作成', onclick: function () { go('templates'); } }) : null,
          can('editor') ? h('button', { class: 'btn primary', text: '＋ 新規作成', onclick: function () { go('edit', null); } }) : null
        ])]),
      h('div', { class: 'stats' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'v', text: String(published) }), h('div', { class: 'l', text: '公開中のアンケート' })]),
        h('div', { class: 'stat' }, [h('div', { class: 'v', text: String(totalRes) }), h('div', { class: 'l', text: '回答の合計' })]),
        h('div', { class: 'stat', role: pendingAll ? 'button' : null, onclick: pendingAll ? function () { go('dashboard'); } : null },
          [h('div', { class: 'v', text: String(pendingAll) }), h('div', { class: 'l', text: '未分析の回答' + (pendingAll ? '（タップで分析へ）' : '') })])
      ]),
      h('div', { class: 'list-tools' }, [search, sortSel]),
      chips,
      listBox
    );
  }
  async function setStatus(s, status) {
    if (status === 'closed' && !confirm('「' + s.title + '」の受付を停止しますか？')) return;
    await run(async function () { await call('setStatus', { survey_id: s.survey_id, status: status }); toast(STATUS_LABELS[status] + 'にしました'); go('surveys'); });
  }
  async function duplicate(s) {
    await run(async function () { var r = await call('duplicateSurvey', { survey_id: s.survey_id }); toast('複製しました（下書き）'); go('edit', r.survey_id); });
  }

  /* ---------- テンプレート ---------- */
  function viewTemplates() {
    var token = navSeq; // 後から別のタブに移ったら、この画面は描かない
    paint(token,
      h('div', { class: 'row between' }, [
        h('h2', { text: 'テンプレートから作成' }),
        h('button', { class: 'btn small', type: 'button', text: '← 一覧へ', onclick: function () { go('surveys'); } })
      ]),
      h('p', { class: 'muted small', text: '選ぶと編集画面に読み込まれます。中身を確認・修正して「保存する」を押すと、下書きとして登録されます。' }),
      h('div', {}, (window.SURVEY_TEMPLATES || []).map(function (t) {
        return h('div', { class: 'card' }, [
          h('strong', { text: t.name }),
          h('p', { class: 'muted small', text: t.note + '（質問 ' + t.survey.questions.length + '問）' }),
          h('button', { class: 'btn small primary', type: 'button', text: 'これを使う', onclick: function () {
            go('edit', JSON.parse(JSON.stringify(t.survey)));
          } })
        ]);
      }))
    );
  }

  /* ---------- アンケート編集 ---------- */
  // arg が文字列なら既存アンケートの編集、オブジェクトならテンプレートからの新規作成
  // arg：文字列なら既存アンケートを読み込む。オブジェクトならその内容（テンプレートやAIの案）を表示する
  async function viewEditor(arg) {
    var token = navSeq; // 後から別のタブに移ったら、この画面は描かない
    var surveyId = typeof arg === 'string' ? arg : (arg && arg.survey_id) || null;
    var aiChanges = arg && typeof arg === 'object' ? arg.changes : null;
    var data = { title: '', description: '', community: '漢の福袋', questions: [
      { text: 'お名前', type: 'name', required: true, meaning_label: 'name' },
      { text: 'メールアドレス', help_text: '回答の控えをお送りします', type: 'email', required: true, meaning_label: 'email' }
    ] };
    if (typeof arg === 'string') {
      data = await run(function () { return call('getSurveyFull', { survey_id: surveyId }); });
      if (!data) return;
    } else if (arg && typeof arg === 'object') {
      data = arg;
    }
    var title = h('input', { type: 'text', value: data.title, placeholder: '例：2026年秋 合宿アンケート' });
    var community = h('input', { type: 'text', value: data.community || '漢の福袋' });
    var desc = h('textarea', { value: data.description || '', placeholder: '回答者へのひと言（任意）' });
    desc.style.minHeight = '80px';
    var qWrap = h('div');
    var questions = data.questions.map(function (q) {
      return Object.assign({}, q, { choices: [].concat(q.choices || []), options: Object.assign({}, q.options || {}) });
    });

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
        var o = q.options;
        var other = h('input', { type: 'checkbox', checked: !!o.allow_other, onchange: function () { o.allow_other = other.checked; } });
        function numSelect(from, to, cur, set) {
          var el = h('select', { onchange: function () { set(Number(el.value)); } });
          for (var n = from; n <= to; n++) el.appendChild(h('option', { value: String(n), text: String(n), selected: n === cur }));
          return el;
        }
        var scaleBox = q.type !== 'scale' ? null : h('div', { class: 'full', style: 'display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))' }, [
          h('div', {}, [h('span', { class: 'field-label', text: '最小' }), numSelect(0, 1, o.scale_min === 0 ? 0 : 1, function (v) { o.scale_min = v; })]),
          h('div', {}, [h('span', { class: 'field-label', text: '最大' }), numSelect(2, 10, o.scale_max || 10, function (v) { o.scale_max = v; })]),
          h('div', {}, [h('span', { class: 'field-label', text: '最小側の言葉（任意）' }),
            h('input', { type: 'text', value: o.label_min || '', placeholder: '例：全く思わない', oninput: function (e) { o.label_min = e.target.value; } })]),
          h('div', {}, [h('span', { class: 'field-label', text: '最大側の言葉（任意）' }),
            h('input', { type: 'text', value: o.label_max || '', placeholder: '例：強くそう思う', oninput: function (e) { o.label_max = e.target.value; } })])
        ]);
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
            CHOICE_TYPES[q.type] ? h('div', { class: 'full' }, [h('span', { class: 'field-label', text: '選択肢（1行に1つ）' }), choices]) : null,
            scaleBox,
            h('div', { class: 'full row' }, [
              h('label', { class: 'check small' }, [req, '必須']),
              q.type === 'choice' || q.type === 'checkbox' ? h('label', { class: 'check small' }, [other, '「その他（自由記入）」を付ける']) : null
            ])
          ])
        ]);
      }));
    }
    renderQuestions();

    // ---- AI ----
    function current() {
      return { survey_id: surveyId || '', title: title.value, community: community.value, description: desc.value,
        status: data.status, questions: questions };
    }
    var aiBox = h('div');
    function need(v, msg) { if (!String(v || '').trim()) throw new Error(msg); return String(v).trim(); }
    function loadSurveyAnswer(text, keepIds) {
      var r = AiPrompts.normalizeSurvey(AiPrompts.extractJson(text), state.labels);
      // 今のアンケートに無い question_id を書いてきたら、新しい質問として扱う
      var known = {};
      (keepIds || []).forEach(function (id) { if (id) known[id] = true; });
      r.questions.forEach(function (q) { if (!known[q.question_id]) q.question_id = ''; });
      toast('AIの案を読み込みました（まだ保存されていません）');
      go('edit', Object.assign(r, { survey_id: surveyId || '', community: community.value, status: data.status }));
    }
    function aiDraftForm() {
      var f1 = h('textarea', { id: 'ai-purpose', placeholder: '例：11月の秋合宿の振り返り' });
      var f2 = h('textarea', { id: 'ai-audience', placeholder: '例：合宿に参加したメンバー（30〜50代の経営者・会社員）' });
      var f3 = h('textarea', { id: 'ai-goal', placeholder: '例：満足度と変化を知りたい。次回の企画と紹介文に使いたい' });
      aiBox.replaceChildren(h('div', { style: 'display:grid;gap:8px;margin-top:10px' }, [
        h('span', { class: 'field-label', text: '1. 何のアンケートですか？（イベント名や目的）' }), f1,
        h('span', { class: 'field-label', text: '2. 誰に答えてもらいますか？' }), f2,
        h('span', { class: 'field-label', text: '3. 回答から何を知りたいですか？ 何に使いますか？' }), f3,
        aiExchange(function () {
          return AiPrompts.draft({ purpose: need(f1.value, '1. 何のアンケートかを書いてください。'),
            audience: need(f2.value, '2. 誰に答えてもらうかを書いてください。'),
            goal: need(f3.value, '3. 何を知りたいかを書いてください。') }, state.labels);
        }, function (text) { loadSurveyAnswer(text, []); }, '④ 読み込んで編集画面に入れる')
      ]));
    }
    function aiReviseForm() {
      var f = h('textarea', { id: 'ai-instruction', placeholder: '例：満足度の質問を0〜5の目盛りにして、参加日を聞く質問を足して' });
      aiBox.replaceChildren(h('div', { style: 'display:grid;gap:8px;margin-top:10px' }, [
        h('span', { class: 'field-label', text: 'どう直したいですか？' }), f,
        aiExchange(function () {
          return AiPrompts.revise(current(), need(f.value, 'どう直したいかを書いてください。'), state.labels);
        }, function (text) {
          loadSurveyAnswer(text, questions.map(function (q) { return q.question_id; }));
        }, '④ 読み込んで編集画面に入れる')
      ]));
    }
    var aiPanel = !can('editor') ? null : h('div', { class: 'card ai-panel' }, [
      h('div', { class: 'row between' }, [
        h('strong', { text: 'AIに手伝ってもらう' }),
        h('div', { class: 'row' }, [
          surveyId ? null : h('button', { class: 'btn small', type: 'button', text: 'AIで作る（3つの質問に答える）', onclick: aiDraftForm }),
          h('button', { class: 'btn small', type: 'button', text: 'AIに修正依頼', onclick: aiReviseForm })
        ])
      ]),
      h('p', { class: 'muted small', text: 'お金がかからないように、Claude のチャット（今の定額プラン）を使います。依頼文をコピーして Claude に貼り、返ってきた答えをここに貼り戻してください。AIの案は編集画面に入るだけで、「保存する」を押すまで登録されません。' }),
      aiBox
    ]);
    var changesBox = aiChanges && aiChanges.length ? h('div', { class: 'card', style: 'border-color:var(--gold)' }, [
      h('strong', { text: 'AIの案です（まだ保存されていません）' }),
      h('ul', { class: 'ai-changes' }, aiChanges.map(function (c) { return h('li', { text: c }); })),
      h('p', { class: 'muted small', text: '確かめて問題なければ、いちばん下の「保存する」を押してください。やめる場合は保存せずに「← 一覧へ」で戻ります。' })
    ]) : null;

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

    paint(token, 
      h('div', { class: 'row between' }, [
        h('h2', { text: !can('editor') ? '質問の内容（閲覧専用）' : surveyId ? 'アンケートを編集' : 'アンケートを新規作成' }),
        h('button', { class: 'btn small', type: 'button', text: '← 一覧へ', onclick: function () { go('surveys'); } })
      ]),
      changesBox,
      aiPanel,
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
      !can('editor') ? null : h('div', { class: 'row', style: 'margin:12px 0 24px' }, [
        h('button', { class: 'btn', type: 'button', text: '＋ 質問を追加', onclick: function () {
          questions.push({ text: '', type: 'textarea', required: false, meaning_label: 'other', choices: [] });
          renderQuestions();
        } })
      ]),
      !can('editor') ? null : h('div', { class: 'row' }, [saveBtn,
        h('span', { class: 'muted small', text: '新規作成したアンケートは「下書き」です。一覧で「公開する」を押すと回答を受け付けます。' })])
    );
  }

  /* ---------- 回答一覧 ---------- */
  async function viewResponses(surveyId) {
    var token = navSeq; // 後から別のタブに移ったら、この画面は描かない
    if (!(await run(loadSurveys))) { if (!state.surveys.length) paint(token, h('p', { class: 'muted', text: 'アンケートがありません。' })); return; }
    surveyId = surveyId || (state.surveys[0] && state.surveys[0].survey_id);
    if (!surveyId) { paint(token, h('p', { class: 'muted', text: 'アンケートがありません。' })); return; }
    var body = h('div', {}, [loading()]);
    var exportAllBtn = h('button', { class: 'btn small', type: 'button', text: '全アンケートを縦持ちCSVで出力', onclick: exportLongCsv });
    paint(token, 
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
      ]) : h('div', { class: 'ai-box muted', text: 'AI分析はまだです。「AI分析」タブからまとめて分析できます。' })
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
    var token = navSeq; // 後から別のタブに移ったら、この画面は描かない
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
    paint(token, 
      h('h2', { text: '人別（回答者 ' + people.length + '人）' }),
      h('div', { class: 'row', style: 'margin-bottom:12px' }, [q]),
      h('div', { class: 'table-wrap card' }, h('table', {}, [
        h('thead', {}, h('tr', {}, ['名前', 'メール', '回答数', '初回', '最終'].map(function (t) { return h('th', { text: t }); }))),
        tbody
      ]))
    );
  }

  async function viewPerson(p) {
    var token = navSeq; // 後から別のタブに移ったら、この画面は描かない
    var data = await run(function () { return call('listResponses', { respondent_id: p.respondent_id }); });
    if (!data) return;
    paint(token, 
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
    var token = navSeq; // 後から別のタブに移ったら、この画面は描かない
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

    // 未分析の回答を Claude のチャットで分析する
    var BATCH = 15;
    // 依頼文はボタンを押した瞬間に作るので、必要な回答とタグは先に読み込んでおく
    var allRes = can('editor') && d.pending ? await run(function () { return call('listResponses', {}); }) : null;
    var allTags = can('editor') && d.pending ? (await run(function () { return call('listTags'); })) || [] : [];
    var analyzePanel = !can('editor') || !d.pending ? null : h('div', { class: 'card ai-panel' }, [
      h('strong', { text: '未分析の回答をAIで分析する（' + d.pending + '件）' }),
      h('p', { class: 'muted small', text: 'お金がかからないように、Claude のチャットを使います。一度に' + BATCH + '件ずつ依頼文を作ります。名前とメールアドレスは依頼文に入れません。' }),
      aiExchange(function () {
        if (!allRes) throw new Error('回答を読み込めませんでした。「最新にする」を押してから試してください。');
        var pending = allRes.responses.filter(function (r) { return !r.ai && (!surveyId || r.survey_id === surveyId); }).slice(0, BATCH);
        if (!pending.length) throw new Error('未分析の回答はありません。「最新にする」を押してから試してください。');
        return AiPrompts.analysis(pending, allTags);
      }, async function (text) {
        var items = AiPrompts.normalizeAnalysis(AiPrompts.extractJson(text));
        var r = await call('importAnalysis', { items: items });
        toast(r.saved + '件の分析を保存しました' + (r.new_tags.length ? '（新しいタグ：' + r.new_tags.join('、') + '）' : '') +
          (r.skipped.length ? '。見つからないIDが' + r.skipped.length + '件ありました' : ''), !!r.skipped.length);
        reloadAll();
      }, '④ 分析結果を保存する')
    ]);

    paint(token, 
      h('h2', { text: 'AI分析ダッシュボード' }),
      h('div', { class: 'row', style: 'margin-bottom:14px' }, [surveySelect(surveyId, true, function (v) { go('dashboard', v); })]),
      analyzePanel,
      h('div', { class: 'stats' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'v', text: String(d.total_responses) }), h('div', { class: 'l', text: '回答数' })]),
        h('div', { class: 'stat' }, [h('div', { class: 'v', text: String(d.analyzed) }), h('div', { class: 'l', text: 'AI分析済み' })]),
        h('div', { class: 'stat' }, [h('div', { class: 'v', text: String(d.pending) }), h('div', { class: 'l', text: '未分析' })])
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
    var token = navSeq; // 後から別のタブに移ったら、この画面は描かない
    var tags = await run(function () { return call('listTags'); });
    if (!tags) return;
    var CAT = { pain: '悩み', change: '変化', outcome: '成果' };
    var tbody = h('tbody');
    function draw() {
      tbody.replaceChildren.apply(tbody, tags.map(function (t, i) {
        var ro = !can('editor');
        var name = h('input', { type: 'text', value: t.tag, disabled: ro, oninput: function () { t.tag = name.value; } });
        var cat = h('select', { disabled: ro, onchange: function () { t.category = cat.value; } }, Object.keys(CAT).map(function (c) {
          return h('option', { value: c, text: CAT[c], selected: t.category === c });
        }));
        var desc = h('input', { type: 'text', value: t.description, disabled: ro, oninput: function () { t.description = desc.value; } });
        return h('tr', {}, [h('td', {}, name), h('td', {}, cat), h('td', {}, desc),
          h('td', {}, ro ? null : h('button', { class: 'btn small danger', type: 'button', text: '削除', onclick: function () { tags.splice(i, 1); draw(); } }))]);
      }));
    }
    draw();
    paint(token, 
      h('h2', { text: 'タグ辞書' }),
      h('p', { class: 'muted small', text: 'AIはここにあるタグを優先して使います（表記ゆれ防止）。似たタグを1つにまとめると集計がきれいになります。新しいタグはAIが自動で追加します。' }),
      h('div', { class: 'table-wrap card' }, h('table', {}, [
        h('thead', {}, h('tr', {}, ['タグ', '分類', '説明', ''].map(function (t) { return h('th', { text: t }); }))), tbody
      ])),
      !can('editor') ? null : h('div', { class: 'row' }, [
        h('button', { class: 'btn', type: 'button', text: '＋ タグを追加', onclick: function () { tags.push({ tag: '', category: 'pain', description: '' }); draw(); } }),
        h('button', { class: 'btn primary', type: 'button', text: '保存する', onclick: async function () {
          await run(async function () { var r = await call('saveTags', { tags: tags }); toast(r.count + '件のタグを保存しました'); go('tags'); });
        } })
      ])
    );
  }

  /* ---------- 鍵（オーナーだけ） ---------- */
  async function viewKeys(created) {
    var token = navSeq; // 後から別のタブに移ったら、この画面は描かない
    var keys = await run(function () { return call('listKeys'); });
    if (!keys) return;
    var name = h('input', { type: 'text', id: 'key-name', placeholder: '渡す人の名前（例：田中さん）' });
    var role = h('select', { id: 'key-role' }, [
      h('option', { value: 'viewer', text: '閲覧専用（回答・分析を見るだけ）' }),
      h('option', { value: 'editor', text: '編集できる（アンケートの作成・公開/停止も可）' }),
      h('option', { value: 'owner', text: 'オーナー（すべて＋鍵の発行・停止も可）' })
    ]);
    var createBtn = h('button', { class: 'btn primary', type: 'button', text: '鍵を発行する', onclick: async function () {
      createBtn.disabled = true;
      var r = await run(function () { return call('createKey', { name: name.value, role: role.value }); });
      createBtn.disabled = false;
      if (r) viewKeys(r);
    } });
    var shown = created ? h('div', { class: 'card', style: 'border-color:var(--gold)' }, [
      h('h3', { text: '「' + created.name + '」の鍵を発行しました（' + ROLE_LABELS[created.role] + '）' }),
      h('p', { class: 'small', text: 'この鍵は今だけ表示されます。画面を離れると二度と表示できないので、今コピーして本人だけに送ってください。' }),
      h('p', {}, h('code', { text: created.key, style: 'word-break:break-all;color:var(--gold-soft)' })),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn small primary', type: 'button', text: '鍵をコピー', onclick: function () { copy(created.key); } }),
        h('button', { class: 'btn small', type: 'button', text: '案内文をコピー', onclick: function () {
          copy('漢の福袋アンケートの管理画面です。\n' + new URL('./admin.html', location.href).href +
            '\n\nあなた専用の鍵（' + ROLE_LABELS[created.role] + '）：\n' + created.key + '\n\n※この鍵は他の人に共有しないでください。');
        } })
      ])
    ]) : null;
    paint(token,
      h('h2', { text: '鍵の管理' }),
      h('p', { class: 'muted small', text: '一人ずつ別の鍵を渡せます。停止すると、その人だけが入れなくなります（あなたや他の人の鍵はそのまま使えます）。元のオーナーの鍵（ADMIN_KEY）は、ここからは停止できません。' }),
      shown,
      h('div', { class: 'card' }, [
        h('h3', { text: '新しい鍵を発行' }),
        h('div', { style: 'display:grid;gap:8px' }, [name, role, h('div', {}, createBtn)])
      ]),
      h('div', { class: 'card table-wrap' }, keys.length ? h('table', {}, [
        h('thead', {}, h('tr', {}, ['名前', '権限', '発行日', '最終利用', ''].map(function (t) { return h('th', { text: t }); }))),
        h('tbody', {}, keys.map(function (k) {
          var stop = h('button', { class: 'btn small danger', type: 'button', text: '停止', onclick: async function () {
            if (stop.dataset.armed !== '1') { stop.dataset.armed = '1'; stop.textContent = '本当に停止する'; return; }
            stop.disabled = true;
            if (await run(function () { return call('revokeKey', { id: k.id }); })) { toast('「' + k.name + '」の鍵を停止しました'); go('keys'); }
          } });
          return h('tr', {}, [h('td', { text: k.name }), h('td', { text: ROLE_LABELS[k.role] || k.role }),
            h('td', { text: fmt(k.created_at) }), h('td', { text: k.last_used ? fmt(k.last_used) + '（目安）' : '未使用' }), h('td', {}, stop)]);
        }))
      ]) : h('p', { class: 'muted small', text: 'まだ鍵を発行していません。今はオーナーの鍵（ADMIN_KEY）だけが使えます。' }))
    );
  }

  /* ---------- 起動 ---------- */
  var saved = '';
  try { saved = sessionStorage.getItem(KEY_STORE) || ''; } catch (e) {}
  if (saved) login(saved); else renderLogin();
})();
