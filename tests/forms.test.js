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

console.log('OK: forms tests passed');
