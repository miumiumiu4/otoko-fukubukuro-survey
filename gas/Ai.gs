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
