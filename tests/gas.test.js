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

// AI分析：APIは呼ばず、Claude のチャットで作った結果を取り込む
let dash = post({ action: 'dashboard', adminKey }).data;
assert.strictEqual(dash.pending, 2);
assert.ok(!('ai_ready' in dash));
const resIds = post({ action: 'listResponses', adminKey, survey_id: sid }).data.responses.map(r => r.response_id);
const item = id => ({ response_id: id, summary: '自信がなかったが行動できるようになった', before_state: '自信がない', after_state: '毎朝走る',
  pain_tags: ['自信がない'], change_tags: ['行動力が上がった', '朝型になった'], outcome_numbers: ['体重 -5kg'],
  recommend_target: ['一歩踏み出せない30代'], best_quote: '人生が変わった3日間でした',
  new_tags: [{ tag: '朝型になった', category: 'change', description: '早起きが習慣化' }] });
let imp = post({ action: 'importAnalysis', adminKey, items: [item(resIds[0]), item(resIds[1]), item('r_not_exist')] });
assert.ok(imp.ok, JSON.stringify(imp));
assert.strictEqual(imp.data.saved, 2);
assert.deepStrictEqual(imp.data.skipped, ['r_not_exist']);
assert.deepStrictEqual(imp.data.new_tags, ['朝型になった']);
// 同じ回答をもう一度取り込むと上書き（重複しない）
assert.ok(post({ action: 'importAnalysis', adminKey, items: [item(resIds[0])] }).ok);
assert.strictEqual(sheets.AI_Analysis._data.filter(r => r[0] === resIds[0]).length, 1);
assert.strictEqual(post({ action: 'importAnalysis', adminKey, items: [] }).ok, false);
assert.strictEqual(gas.claudeCalls.length, 0, '外部のAIには一切つながない');

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

// 鍵と権限
assert.strictEqual(post({ action: 'ping', adminKey }).data.user.role, 'owner');
const ed = post({ action: 'createKey', adminKey, name: '友達A', role: 'editor' }).data;
const vw = post({ action: 'createKey', adminKey, name: '友達B', role: 'viewer' }).data;
assert.ok(ed.key && vw.key && ed.key !== vw.key);
assert.strictEqual(post({ action: 'createKey', adminKey, name: '友達A', role: 'viewer' }).ok, false, '同名は作れない');
assert.ok(!JSON.stringify(props).includes(ed.key), '鍵の値そのものは保存しない');
const keys = post({ action: 'listKeys', adminKey }).data;
assert.strictEqual(keys.length, 2);
assert.ok(!('hash' in keys[0]), '一覧にハッシュを出さない');
// 閲覧専用：見られるが変えられない
let v = post({ action: 'ping', adminKey: vw.key }).data.user;
assert.deepStrictEqual([v.name, v.role], ['友達B', 'viewer']);
assert.ok(post({ action: 'listResponses', adminKey: vw.key, survey_id: sid }).ok);
assert.ok(post({ action: 'dashboard', adminKey: vw.key }).ok);
for (const a of ['saveSurvey', 'duplicateSurvey', 'setStatus', 'importAnalysis', 'saveTags', 'listKeys', 'createKey', 'revokeKey']) {
  const r = post({ action: a, adminKey: vw.key, survey_id: sid, status: 'draft', survey: full2, tags: [] });
  assert.strictEqual(r.ok, false, a);
  assert.ok(/権限がありません/.test(r.error), a + ': ' + r.error);
}
// 編集できる鍵：編集はできるが鍵の管理はできない
assert.ok(post({ action: 'setStatus', adminKey: ed.key, survey_id: sid, status: 'published' }).ok);
assert.strictEqual(post({ action: 'listKeys', adminKey: ed.key }).ok, false);
assert.strictEqual(post({ action: 'createKey', adminKey: ed.key, name: 'x', role: 'editor' }).ok, false);
// 発行したオーナーの鍵：鍵の管理もできるが、元の ADMIN_KEY は止められない
const ow = post({ action: 'createKey', adminKey, name: '入山さん', role: 'owner' }).data;
assert.ok(ow.key.startsWith('o-'));
assert.deepStrictEqual(post({ action: 'ping', adminKey: ow.key }).data.user.role, 'owner');
const tmp = post({ action: 'createKey', adminKey: ow.key, name: '一時', role: 'viewer' }).data;
assert.ok(post({ action: 'revokeKey', adminKey: ow.key, id: tmp.id }).ok);
assert.strictEqual(post({ action: 'revokeKey', adminKey: ow.key, id: 'owner' }).ok, false);
assert.ok(post({ action: 'ping', adminKey }).ok);
assert.strictEqual(post({ action: 'createKey', adminKey, name: 'x', role: 'god' }).ok, false);

// 停止すると使えなくなる
assert.ok(post({ action: 'revokeKey', adminKey, id: vw.id }).ok);
assert.strictEqual(post({ action: 'ping', adminKey: vw.key }).ok, false);
assert.ok(post({ action: 'ping', adminKey: ed.key }).ok, '他の鍵は影響を受けない');
assert.ok(post({ action: 'ping', adminKey }).ok, 'オーナーも影響を受けない');

console.log('OK: all GAS tests passed');
