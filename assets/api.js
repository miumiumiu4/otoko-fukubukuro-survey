// GAS ウェブアプリ呼び出し。Content-Type を text/plain にして CORS プリフライトを回避する。
(function () {
  async function call(action, params) {
    var url = (window.SURVEY_CONFIG || {}).API_URL;
    if (!url) throw new Error('API_URL が未設定です（config.js）。');
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, params || {})),
      redirect: 'follow'
    });
    var json;
    try { json = await res.json(); } catch (e) { throw new Error('サーバーの応答を読み取れませんでした。'); }
    if (!json.ok) throw new Error(json.error || 'エラーが発生しました。');
    return json.data;
  }

  // 要素生成の小さなヘルパー（文字は必ず textContent で入れて XSS を防ぐ）
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    [].concat(children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    var p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  window.SurveyApi = { call: call, h: h, fmtDate: fmtDate };
})();
