// Google フォーム相当の形式と、AI でアンケートを作る・直す機能のテスト。実行: node tests/forms.test.js
const assert = require('assert');
const { createGas } = require('./gas-mock');
const gas = createGas();
const { post, props, sheets } = gas;
gas.ctx.setup();
const adminKey = props.ADMIN_KEY;

// 新しい形式でアンケートを作る
const survey = { title: '形式テスト', questions: [
  { text: '名前', type: 'name', required: true },
  { text: 'メール', type: 'email', required: true },
  { text: '好きな食べ物（複数可）', type: 'checkbox', required: true, choices: ['肉', '魚', '野菜'], options: { allow_other: true } },
  { text: '地域', type: 'dropdown', required: true, choices: ['北海道', '東北', '関東'] },
  { text: '性別', type: 'choice', required: false, choices: ['男性', '女性'], options: { allow_other: true } },
  { text: '満足度', type: 'scale', required: true, options: { scale_min: 0, scale_max: 5, label_min: '不満', label_max: '大満足' } },
  { text: '参加日', type: 'date', required: true },
  { text: '到着時刻', type: 'time', required: false },
  { text: '不正な目盛り', type: 'scale', options: { scale_min: 3, scale_max: 99 } }
] };
const sid = post({ action: 'saveSurvey', adminKey, survey }).data.survey_id;
assert.ok(sheets.Questions._data[0].includes('options'), '見出しに options 列がある');
post({ action: 'setStatus', adminKey, survey_id: sid, status: 'published' });
const qs = post({ action: 'getSurvey', survey_id: sid }).data.questions;
const q = t => qs.find(x => x.text === t);
assert.deepStrictEqual(q('満足度').options, { scale_min: 0, scale_max: 5, label_min: '不満', label_max: '大満足' });
assert.deepStrictEqual(q('不正な目盛り').options, { scale_min: 1, scale_max: 10, label_min: '', label_max: '' });
assert.strictEqual(q('好きな食べ物（複数可）').options.allow_other, true);
assert.deepStrictEqual(q('地域').options, {}, 'プルダウンにはその他が無い');

function answers(over) {
  const a = {};
  a[q('名前').question_id] = '山田'; a[q('メール').question_id] = 'y@example.com';
  a[q('好きな食べ物（複数可）').question_id] = ['肉', 'その他: 甘いもの'];
  a[q('地域').question_id] = '東北'; a[q('満足度').question_id] = '0';
  a[q('参加日').question_id] = '2026-10-11'; a[q('到着時刻').question_id] = '09:30';
  return Object.assign(a, over || {});
}
const ok = post({ action: 'submit', survey_id: sid, answers: answers() });
assert.ok(ok.ok, JSON.stringify(ok));
const stored = sheets.Answers._data.filter(r => r[1] === q('好きな食べ物（複数可）').question_id)[0];
assert.strictEqual(stored[3], '肉 | その他: 甘いもの', '複数回答は | でつなぐ');
const bad = (over, msg) => assert.strictEqual(post({ action: 'submit', survey_id: sid, answers: answers(over) }).ok, false, msg);
bad({ [q('好きな食べ物（複数可）').question_id]: [] }, '必須の複数回答が空');
bad({ [q('好きな食べ物（複数可）').question_id]: ['ラーメン'] }, '選択肢に無い');
bad({ [q('地域').question_id]: 'その他: 沖縄' }, 'プルダウンにその他は無い');
bad({ [q('性別').question_id]: 'その他: ' }, 'その他が空');
assert.ok(post({ action: 'submit', survey_id: sid, answers: answers({ [q('性別').question_id]: 'その他: 答えない' }) }).ok);
bad({ [q('満足度').question_id]: '6' }, '目盛りの範囲外');
bad({ [q('参加日').question_id]: '10/11' }, '日付の形式');
bad({ [q('到着時刻').question_id]: '9時' }, '時刻の形式');

// 複製で設定も引き継ぐ
const dup = post({ action: 'duplicateSurvey', adminKey, survey_id: sid }).data.survey_id;
const dq = post({ action: 'getSurveyFull', adminKey, survey_id: dup }).data.questions.find(x => x.text === '満足度');
assert.strictEqual(dq.options.scale_max, 5);

// AI：キーが無いと分かりやすく止まる
let r = post({ action: 'aiDraftSurvey', adminKey, purpose: 'a', audience: 'b', goal: 'c' });
assert.ok(!r.ok && /ANTHROPIC_API_KEY/.test(r.error));
props.ANTHROPIC_API_KEY = 'k';
let lastBody;
gas.ctx.UrlFetchApp.fetch = (url, opt) => {
  lastBody = JSON.parse(opt.payload);
  const out = { title: '秋合宿アンケート', description: 'お疲れさまでした。', changes: ['満足度を追加'], questions: [
    { question_id: 'qNOPE', text: 'お名前', help_text: '', type: 'name', required: true, choices: [], meaning_label: 'name', allow_other: false, scale_min: 1, scale_max: 10, label_min: '', label_max: '' },
    { question_id: '', text: '満足度', help_text: '', type: 'scale', required: true, choices: ['x'], meaning_label: 'satisfaction', allow_other: false, scale_min: 1, scale_max: 5, label_min: '低い', label_max: '高い' },
    { question_id: '', text: '良かった点', help_text: '', type: 'checkbox', required: false, choices: ['食事', '講義'], meaning_label: 'insight', allow_other: true, scale_min: 1, scale_max: 10, label_min: '', label_max: '' }
  ] };
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] }) };
};
// 閲覧専用は使えない
const vk = post({ action: 'createKey', adminKey, name: '見る人', role: 'viewer' }).data.key;
assert.strictEqual(post({ action: 'aiDraftSurvey', adminKey: vk, purpose: 'a', audience: 'b', goal: 'c' }).ok, false);
assert.strictEqual(post({ action: 'aiDraftSurvey', adminKey, purpose: '', audience: 'b', goal: 'c' }).ok, false, '3つ全部必要');
r = post({ action: 'aiDraftSurvey', adminKey, purpose: '秋合宿の振り返り', audience: '参加者', goal: '次回の企画' }).data;
assert.strictEqual(lastBody.output_config.format.type, 'json_schema');
assert.ok(lastBody.messages[0].content.includes('秋合宿の振り返り'));
assert.strictEqual(r.questions[1].options.scale_max, 5);
assert.deepStrictEqual(r.questions[1].choices, [], '目盛りに選択肢は持たせない');
assert.deepStrictEqual(r.questions[2].options, { allow_other: true });
assert.strictEqual(r.changes[0], '満足度を追加');
assert.strictEqual(post({ action: 'listSurveys', adminKey }).data.length, 3, 'AIの案は保存されない');

// 修正依頼：存在しない question_id は新しい質問扱い、実在するものは残す
const full = post({ action: 'getSurveyFull', adminKey, survey_id: sid }).data;
const realId = full.questions[0].question_id;
gas.ctx.UrlFetchApp.fetch = (url, opt) => {
  lastBody = JSON.parse(opt.payload);
  const out = { title: full.title, description: '', changes: ['参加日を削除'], questions: [
    { question_id: realId, text: 'お名前', help_text: '', type: 'name', required: true, choices: [], meaning_label: 'name', allow_other: false, scale_min: 1, scale_max: 10, label_min: '', label_max: '' },
    { question_id: 'qFAKE', text: '新しい質問', help_text: '', type: 'text', required: false, choices: [], meaning_label: 'other', allow_other: false, scale_min: 1, scale_max: 10, label_min: '', label_max: '' }
  ] };
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] }) };
};
r = post({ action: 'aiReviseSurvey', adminKey, survey: full, instruction: '参加日の質問を消して' }).data;
assert.ok(lastBody.messages[0].content.includes(realId) && lastBody.messages[0].content.includes('参加日の質問を消して'));
assert.strictEqual(r.questions[0].question_id, realId);
assert.strictEqual(r.questions[1].question_id, '');
assert.strictEqual(post({ action: 'aiReviseSurvey', adminKey, survey: full, instruction: ' ' }).ok, false);

console.log('OK: forms tests passed');
