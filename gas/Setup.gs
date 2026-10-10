/**
 * 初回だけ GAS エディタで「setup」を実行する。
 * - データ用スプレッドシートを作成（既にあれば足りないシートだけ追加）
 * - 管理者キーを自動生成してスクリプトプロパティ ADMIN_KEY に保存（コードには残らない）
 * - 未分析回答を10分ごとにAI分析するトリガーを設定
 * - サンプルのアンケートを1件作成
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('漢の福袋 アンケート DB');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  _ssCache = ss;

  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var header = SCHEMA[name];
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var first = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);

  if (readAll_('Tags').length === 0) append_('Tags', DEFAULT_TAGS);
  if (readAll_('Surveys').length === 0) createSampleSurvey_();

  if (!props.getProperty('ADMIN_KEY')) {
    props.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, ''));
  }

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'analyzePendingTrigger') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('analyzePendingTrigger').timeBased().everyMinutes(10).create();

  console.log('スプレッドシート: ' + ss.getUrl());
  console.log('管理者キーは「プロジェクトの設定 > スクリプト プロパティ > ADMIN_KEY」で確認してください。');
  console.log('AI分析を使うには、スクリプト プロパティに ANTHROPIC_API_KEY を追加してください。');
}

var DEFAULT_TAGS = [
  { tag: '自信がない', category: 'pain', description: '自分に自信が持てず一歩を踏み出せない' },
  { tag: '仕事の伸び悩み', category: 'pain', description: '収入・成果・キャリアが頭打ち' },
  { tag: '人間関係の悩み', category: 'pain', description: '家族・職場・恋愛などの関係に悩む' },
  { tag: '習慣が続かない', category: 'pain', description: '運動・勉強・早起きなどが三日坊主' },
  { tag: '孤独・仲間不足', category: 'pain', description: '本音で話せる仲間がいない' },
  { tag: '体型・健康', category: 'pain', description: '体重・体力・健康面の悩み' },
  { tag: '行動力が上がった', category: 'change', description: '決めたことをすぐ実行できるようになった' },
  { tag: '自信がついた', category: 'change', description: '自己肯定感・自信が高まった' },
  { tag: '仲間ができた', category: 'change', description: '本音で語れる仲間・つながりができた' },
  { tag: '考え方が変わった', category: 'change', description: '物事の捉え方・価値観が変わった' },
  { tag: '習慣が身についた', category: 'change', description: '良い習慣が定着した' },
  { tag: '収入アップ', category: 'outcome', description: '売上・年収など金額の成果' },
  { tag: '体重減少', category: 'outcome', description: '減量など体の数値の成果' }
];

function createSampleSurvey_() {
  apiSaveSurvey_({ survey: {
    title: '漢の福袋 合宿アンケート（サンプル）',
    description: '合宿お疲れさまでした。率直な感想を聞かせてください。今後の企画づくりに活かします。',
    community: '漢の福袋',
    questions: [
      { text: 'お名前', type: 'name', required: true, meaning_label: 'name' },
      { text: 'メールアドレス', help_text: '回答の控えをお送りします', type: 'email', required: true, meaning_label: 'email' },
      { text: '参加する前、どんなことに悩んでいましたか？', type: 'textarea', required: true, meaning_label: 'pain' },
      { text: '参加して、何が一番変わりましたか？', type: 'textarea', required: true, meaning_label: 'change' },
      { text: '特に効いた体験・考え方を教えてください', type: 'textarea', required: false, meaning_label: 'insight' },
      { text: '数字で表せる成果があれば教えてください', help_text: '例：体重 -5kg、売上 月+30万円', type: 'text', required: false, meaning_label: 'outcome' },
      { text: '満足度を教えてください', help_text: '1（不満）〜10（大満足）', type: 'scale', required: true, meaning_label: 'satisfaction' },
      { text: 'どんな人にこの合宿を勧めたいですか？', type: 'text', required: false, meaning_label: 'recommend' },
      { text: 'これから参加する人へ、ひと言お願いします', type: 'textarea', required: false, meaning_label: 'quote' },
      { text: '紹介文やSNSでの掲載について', type: 'choice', required: true, meaning_label: 'other',
        choices: ['名前ありで掲載OK', 'イニシャルなら掲載OK', '掲載NG'] }
    ]
  } });
}
