// 入山さん向け使い方動画の画面収録（サンプルデータ）。各シーンの開始時刻を scenes.json に書く
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { createGas } = require('../../tests/gas-mock');
const fs = require('fs');
// 使い方: node rec.js <作業フォルダ>  （作業フォルダに site/ としてサイト一式と config.js を置く）
const SP = process.argv[2];
const people = [
  { name: '佐藤 健太', email: 'sato@example.com', pain: '仕事は回っているのに、この先どうなりたいかが見えず、毎日が惰性でした。', change: '朝5時に起きて走る習慣がつき、仕事の決断が早くなりました。', num: '売上 月+30万円', q: '迷っている時間がもったいないと気づかせてくれる場所です', pt: ['将来が見えない', '惰性の毎日'], ct: ['行動力が上がった', '朝型になった'] },
  { name: '鈴木 大輔', email: 'suzuki@example.com', pain: '人前で自分の意見を言えず、職場でも家庭でも我慢ばかりしていました。', change: '仲間の前で目標を宣言してから、言いたいことを言えるようになりました。', num: '体重 -4kg', q: '本音で話せる男友達が一気にできる3日間', pt: ['自信がない', '人間関係の悩み'], ct: ['自信がついた', '仲間ができた'] },
  { name: '高橋 翔', email: 'takahashi@example.com', pain: '独立したものの集客がうまくいかず、焦りだけが募っていました。', change: '発信を毎日続けるようになり、問い合わせが増えました。', num: '商談 週2件→週5件', q: 'くすぶっている人の背中を確実に押してくれる', pt: ['仕事の伸び悩み', '自信がない'], ct: ['行動力が上がった', '習慣が身についた'] },
  { name: '田中 誠', email: 'tanaka@example.com', pain: '本音で話せる仲間がいなくて、ずっと一人で抱え込んでいました。', change: '困ったときに相談できる仲間ができ、気持ちがかなり楽になりました。', num: '', q: '一人で頑張るのをやめられる場所', pt: ['孤独・仲間不足'], ct: ['仲間ができた', '考え方が変わった'] }
];
(async () => {
  const gas = createGas(); gas.ctx.setup(); gas.props.ANTHROPIC_API_KEY = 'mock'; const key = gas.props.ADMIN_KEY;
  const P = b => gas.post(Object.assign({ adminKey: key }, b));
  // サンプルのアンケートを消し、タイ合宿だけにする
  const tpl = fs.readFileSync(__dirname + '/../../assets/templates.js', 'utf8');
  const win = {}; new Function('window', tpl)(win);
  const sid = P({ action: 'saveSurvey', survey: win.SURVEY_TEMPLATES[0].survey }).data.survey_id;
  const sample = P({ action: 'listSurveys' }).data.find(s => s.survey_id !== sid);
  gas.ctx.deleteWhere_('Surveys', s => s.survey_id === sample.survey_id);
  P({ action: 'setStatus', survey_id: sid, status: 'published' });
  const qs = P({ action: 'getSurveyFull', survey_id: sid }).data.questions;
  let cur = 0;
  gas.ctx.UrlFetchApp.fetch = () => {
    const x = people[cur];
    const out = { summary: x.pain.slice(0, 20) + '状態から、' + x.change, before_state: x.pain, after_state: x.change,
      pain_tags: x.pt, change_tags: x.ct, outcome_numbers: x.num ? [x.num] : [], recommend_target: ['一歩を踏み出せない30代'], best_quote: x.q, new_tags: [] };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] }) };
  };
  for (let i = 0; i < people.length; i++) {
    const x = people[i], ans = {};
    qs.forEach(q => {
      const m = { name: x.name, email: x.email, pain: x.pain, change: x.change, quote: x.q, recommend: '一歩を踏み出せない30代', insight: '仲間の前で目標を宣言したこと', request: '' }[q.meaning_label];
      ans[q.question_id] = q.type === 'scale' ? String(q.text.includes('参加前') ? 3 + i % 2 : 8 + i % 2) : q.type === 'choice' ? q.choices[i % q.choices.length]
        : q.type === 'text' && q.meaning_label === 'outcome' ? x.num : m !== undefined ? m : '仕事にも家庭にも良い変化が出ています。';
    });
    const r = gas.post({ action: 'submit', survey_id: sid, answers: ans }).data;
    cur = i; gas.ctx.analyzeResponse_(r.response_id, false);
  }
  const vkey = P({ action: 'createKey', name: '入山さん', role: 'owner' }).data.key;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 780, height: 1688 }, deviceScaleFactor: 1,
    recordVideo: { dir: SP + '/video/raw', size: { width: 780, height: 1688 } } });
  const p = await ctx.newPage();
  await p.route('https://fonts.googleapis.com/**', r => r.abort());
  const HOST = 'https://miumiumiu4.github.io/otoko-fukubukuro-survey/';
  await p.route(HOST + '**', async r => {
    const rel = new URL(r.request().url()).pathname.replace('/otoko-fukubukuro-survey/', '') || 'index.html';
    const file = SP + '/site/' + rel;
    if (!fs.existsSync(file)) return r.fulfill({ status: 404, body: '' });
    const type = rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.css') ? 'text/css' : rel.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    await r.fulfill({ status: 200, contentType: type + '; charset=utf-8', body: fs.readFileSync(file) });
  });
  await p.route('https://script.google.com/**', async r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gas.post(JSON.parse(r.request().postData()))) }));
  // タップした場所に金色の円を出す
  // 画面を2倍に拡大して、スマホ（390px幅）の見た目のまま高画質で収録する
  await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = '2'; }); });
  await p.addInitScript(() => {
    addEventListener('pointerdown', e => {
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;left:${e.clientX / 2 - 22}px;top:${e.clientY / 2 - 22}px;width:44px;height:44px;border-radius:50%;border:3px solid #e6cd8c;background:rgba(201,162,74,.35);z-index:99999;pointer-events:none;transition:transform .5s,opacity .5s`;
      document.body.appendChild(d);
      requestAnimationFrame(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0'; });
      setTimeout(() => d.remove(), 600);
    }, true);
  });
  const t0 = Date.now(); const scenes = [];
  const mark = id => scenes.push({ id, t: (Date.now() - t0) / 1000 });
  const wait = ms => p.waitForTimeout(ms);
  const tap = async sel => { await p.locator(sel).first().scrollIntoViewIfNeeded(); await wait(400); await p.locator(sel).first().click(); };

  await p.goto(HOST + 'admin.html');
  mark('login'); await wait(1500);
  await p.locator('input[type=password]').pressSequentially(vkey.slice(0, 14), { delay: 40 });
  await p.fill('input[type=password]', vkey); await wait(800);
  await tap('button[type=submit]'); await p.waitForSelector('text=入山さん（オーナー）'); await wait(2500);
  mark('surveys'); await wait(4500);
  mark('responses'); await tap('nav >> text=回答一覧'); await p.waitForSelector('tr.clickable'); await wait(2000);
  await tap('tr.clickable'); await wait(2500);
  await p.mouse.wheel(0, 500); await wait(2500); await p.mouse.wheel(0, 900); await wait(2500);
  mark('people'); await tap('nav >> text=人別'); await p.waitForSelector('tr.clickable'); await wait(2000);
  await tap('tr.clickable >> nth=1'); await p.waitForSelector('text=さんの回答履歴'); await wait(2500);
  await p.mouse.wheel(0, 600); await wait(2500);
  mark('dashboard'); await tap('nav >> text=AI分析'); await p.waitForSelector('text=悩みタグ ランキング'); await wait(3000);
  await p.mouse.wheel(0, 450); await wait(3000); await p.mouse.wheel(0, 600); await wait(3500);
  mark('csv'); await tap('nav >> text=回答一覧'); await p.waitForSelector('tr.clickable'); await wait(1500);
  await p.locator('text=このアンケートをCSVで出力').hover(); await wait(1500);
  await tap('text=このアンケートをCSVで出力'); await wait(3000);
  mark('logout'); await tap('text=ログアウト'); await p.waitForSelector('input[type=password]'); await wait(3500);
  mark('end');
  await ctx.close(); await browser.close();
  fs.writeFileSync(SP + '/video/scenes.json', JSON.stringify(scenes, null, 1));
  console.log(scenes);
})().catch(e => { console.error(e); process.exit(1); });
