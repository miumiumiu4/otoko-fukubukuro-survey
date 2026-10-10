// GAS コードを Node 上でモックして、API の一連の流れを確かめるテスト。
// 実行: node tests/gas.test.js
const crypto = require('crypto');
const assert = require('assert');
const { createGas } = require('./gas-mock');

const gas = createGas();
const { ctx, post, props, sheets, mails } = gas;

// setup
ctx.setup();
assert.ok(props.SPREADSHEET_ID && props.ADMIN_KEY, 'setup がプロパティを作る');
const adminKey = props.ADMIN_KEY;

// 管理者キー
assert.strictEqual(post({ action: 'listSurveys', adminKey: 'wrong' }).ok, false);
const list = post({ action: 'listSurveys', adminKey });
assert.ok(list.ok && list.data.length === 1, 'サンプルアンケートがある');
const sid = list.data[0].survey_id;

// 下書きは回答不可
let r = post({ action: 'getSurvey', survey_id: sid });
assert.strictEqual(r.data.status, 'draft');
assert.strictEqual(r.data.questions.length, 0);
assert.strictEqual(post({ action: 'submit', survey_id: sid, answers: {} }).ok, false);

// 公開
assert.ok(post({ action: 'setStatus', adminKey, survey_id: sid, status: 'published' }).ok);
r = post({ action: 'getSurvey', survey_id: sid });
const qs = r.data.questions;
assert.strictEqual(qs.length, 10);
assert.ok(!('meaning_label' in qs[0]), '公開APIは意味ラベルを返さない');

const byLabel = {};
const full = post({ action: 'getSurveyFull', adminKey, survey_id: sid }).data;
full.questions.forEach(q => { byLabel[q.meaning_label] = byLabel[q.meaning_label] || q.question_id; });
const answers = {};
full.questions.forEach(q => {
  answers[q.question_id] = { name: '山田太郎', email: 'Taro@Example.com', scale: '9', choice: q.choices[0] }[q.type] || 'テスト回答';
});
// 必須抜け
const missing = Object.assign({}, answers, { [byLabel.pain]: '' });
assert.strictEqual(post({ action: 'submit', survey_id: sid, answers: missing }).ok, false);
// 不正な選択肢
const badChoice = Object.assign({}, answers);
full.questions.filter(q => q.type === 'choice').forEach(q => { badChoice[q.question_id] = 'ハック'; });
assert.strictEqual(post({ action: 'submit', survey_id: sid, answers: badChoice }).ok, false);

// 正常送信 ×2（同じ人、大文字小文字違い）
let s1 = post({ action: 'submit', survey_id: sid, answers });
assert.ok(s1.ok && s1.data.mailed, JSON.stringify(s1));
const answers2 = Object.assign({}, answers, { [byLabel.email]: 'taro@example.com', [byLabel.pain]: '=HYPERLINK("x")' });
assert.ok(post({ action: 'submit', survey_id: sid, answers: answers2 }).ok);
assert.strictEqual(mails.length, 2);
assert.strictEqual(mails[0].to, 'taro@example.com');
const people = post({ action: 'listRespondents', adminKey }).data;
assert.strictEqual(people.length, 1, '同じメールは同一人物');
assert.strictEqual(people[0].survey_count, 2);
assert.strictEqual(people[0].respondent_id, crypto.createHash('sha256').update('taro@example.com').digest('hex').slice(0, 32));
assert.ok(sheets.Answers._data.some(row => row[3] === "'=HYPERLINK(\"x\")"), '数式は文字として保存');

// 編集：question_id が引き継がれる
const edited = JSON.parse(JSON.stringify(full));
edited.questions[2].text = '参加前の悩み（改）';
edited.questions.push({ text: '追加の質問', type: 'text', meaning_label: 'request' });
assert.ok(post({ action: 'saveSurvey', adminKey, survey: edited }).ok);
const full2 = post({ action: 'getSurveyFull', adminKey, survey_id: sid }).data;
assert.strictEqual(full2.questions.length, 11);
assert.strictEqual(full2.questions[2].question_id, full.questions[2].question_id);
assert.strictEqual(sheets.Questions._data.filter(r => r[0] === sid).length, 11, '古い質問行が残らない');

// 複製
const dup = post({ action: 'duplicateSurvey', adminKey, survey_id: sid });
assert.ok(dup.ok);
const dupFull = post({ action: 'getSurveyFull', adminKey, survey_id: dup.data.survey_id }).data;
assert.strictEqual(dupFull.status, 'draft');
assert.strictEqual(dupFull.questions.length, 11);
assert.notStrictEqual(dupFull.questions[0].question_id, full2.questions[0].question_id);

// AI：キー無し
let dash = post({ action: 'dashboard', adminKey }).data;
assert.strictEqual(dash.ai_ready, false);
assert.strictEqual(dash.pending, 2);

props.ANTHROPIC_API_KEY = 'test-key';
const ap = post({ action: 'analyzePending', adminKey, limit: 5 });
assert.ok(ap.ok && ap.data.analyzed === 2, JSON.stringify(ap));
const call = gas.claudeCalls[0];
assert.strictEqual(call.body.model, 'claude-opus-5-5');
assert.strictEqual(call.opt.headers['x-api-key'], 'test-key');
assert.ok(!call.body.messages[0].content.includes('taro@example.com'), 'メールはAIに送らない');
assert.ok(call.body.messages[0].content.includes('自信がない'), '既存タグを渡す');

dash = post({ action: 'dashboard', adminKey, survey_id: sid }).data;
assert.strictEqual(dash.analyzed, 2);
assert.deepStrictEqual(dash.pain_ranking[0], { tag: '自信がない', count: 2 });
assert.strictEqual(dash.outcomes.length, 2);
assert.strictEqual(dash.quotes[0].name, '山田太郎');
const tags = post({ action: 'listTags', adminKey }).data;
assert.strictEqual(tags.filter(t => t.tag === '朝型になった').length, 1, '新タグは1回だけ追加');

const lr = post({ action: 'listResponses', adminKey, respondent_id: people[0].respondent_id }).data;
assert.strictEqual(lr.responses.length, 2);
assert.ok(lr.responses[0].ai && lr.responses[0].answers[0].question_text);

// 停止後は送信不可
post({ action: 'setStatus', adminKey, survey_id: sid, status: 'closed' });
assert.strictEqual(post({ action: 'submit', survey_id: sid, answers }).ok, false);

// タグ保存
assert.strictEqual(post({ action: 'saveTags', adminKey, tags: [{ tag: 'A', category: 'pain' }, { tag: '', category: 'x' }] }).data.count, 1);

console.log('OK: all GAS tests passed');
