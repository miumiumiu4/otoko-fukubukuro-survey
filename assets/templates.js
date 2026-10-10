// 管理画面の「テンプレートから作成」で使うアンケートのひな形。
// 選ぶと編集画面に読み込まれ、「保存する」を押した時点で下書きとして登録される。
window.SURVEY_TEMPLATES = [
  {
    id: 'thai-camp',
    name: 'タイ合宿アンケート（改善版）',
    note: '友人のGoogleフォームが元。数値評価・属性・掲載許可などを足して、人をまたいだ分析ができる形にしたもの。',
    survey: {
      title: '漢の福袋「タイ合宿」アンケート',
      community: '漢の福袋',
      description: [
        'タイ合宿、お疲れさまでした。',
        '回答BGMにお使いください。Willcome: https://youtu.be/CqxWSACRl88',
        '',
        '※入力された内容は、ご記入のメールアドレス宛に控えとしてお送りします。ぜひご自身の振り返りにもご利用ください。',
        '※所要時間の目安は15分ほどです。思いつくまま、具体的に書いてもらえるとうれしいです。'
      ].join('\n'),
      questions: [
        { text: 'お名前', type: 'name', required: true, meaning_label: 'name' },
        { text: 'メールアドレス', help_text: '回答の控えをお送りします。今後のアンケートでも同じアドレスを使ってください（回答をまとめて振り返れるようにするためです）。',
          type: 'email', required: true, meaning_label: 'email' },

        { text: '今回のタイ合宿に参加する前、どんな悩み・課題・行き詰まりを感じていましたか？',
          help_text: 'できるだけ具体的に教えてください。', type: 'textarea', required: true, meaning_label: 'pain' },
        { text: '参加前の自分の状態に点数をつけると、10点満点で何点でしたか？',
          help_text: '1＝どん底、10＝最高の状態。直感で大丈夫です。', type: 'scale', required: true, meaning_label: 'before_after' },

        { text: '今回のタイ合宿に参加して、どんな変化がありましたか？',
          help_text: '考え方・感情・行動・仕事・人間関係・お金など、変化を感じたことがあれば具体的に教えてください。',
          type: 'textarea', required: true, meaning_label: 'change' },
        { text: '受講前と今を比べると、最も大きく変わったことは何ですか？',
          help_text: '「以前は○○だった → 今は○○になった」という形で教えてください。', type: 'textarea', required: true, meaning_label: 'before_after' },
        { text: '今の自分の状態に点数をつけると、10点満点で何点ですか？',
          help_text: '参加前と同じ基準で、1＝どん底、10＝最高の状態。', type: 'scale', required: true, meaning_label: 'before_after' },

        { text: '特に「これは今までと違う」「これは使える」と感じた体験・考え方・ワーク・技術は何でしたか？',
          help_text: 'また、なぜそう感じましたか？', type: 'textarea', required: true, meaning_label: 'insight' },

        { text: 'すでに出ている具体的な成果や行動の変化を教えてください。',
          help_text: '例：仕事、行動量、人間関係、決断、習慣、気持ちの変化など。', type: 'textarea', required: true, meaning_label: 'outcome' },
        { text: '数字で表せる成果があれば教えてください。',
          help_text: '例：売上 月+30万円、体重 -4kg、毎朝5時起き 30日継続、商談数 週2件→週5件。まだ無ければ空欄で大丈夫です。',
          type: 'text', required: false, meaning_label: 'outcome' },

        { text: 'もしこのプログラムを受けていなかったら、今どうなっていたと思いますか？',
          type: 'textarea', required: true, meaning_label: 'change' },

        { text: 'タイ合宿の満足度を教えてください。', help_text: '1＝まったく満足していない、10＝最高に満足。',
          type: 'scale', required: true, meaning_label: 'satisfaction' },

        { text: 'タイ合宿は、どんな人におすすめしたいですか？',
          help_text: '年代・仕事・状況・悩みなど、なるべく具体的な人物像で教えてください。', type: 'textarea', required: true, meaning_label: 'recommend' },
        { text: 'その人に一言で伝えるなら、タイ合宿はどんなプログラムだと説明しますか？',
          help_text: 'ご自身の言葉で、短くひと言でお願いします。', type: 'text', required: true, meaning_label: 'quote' },
        { text: 'ここまでの回答を、紹介文やSNSに載せてもよいですか？',
          help_text: '載せる前に文面を確認したい場合は、その旨を一番下の自由記述欄に書いてください。',
          type: 'choice', required: true, meaning_label: 'other',
          choices: ['名前ありで掲載OK', 'イニシャル・匿名なら掲載OK', '掲載NG（社内の振り返りのみ）'] },

        { text: '次回の合宿やイベントに参加したいですか？', type: 'choice', required: true, meaning_label: 'other',
          choices: ['ぜひ参加したい', '内容や日程しだいで参加したい', '今は考えていない'] },
        { text: '運営への要望や、もっとこうだったら良かったと思うことがあれば教えてください。',
          type: 'textarea', required: false, meaning_label: 'request' },

        { text: '年代', type: 'choice', required: true, meaning_label: 'profile',
          choices: ['20代以下', '30代', '40代', '50代', '60代以上'] },
        { text: 'お仕事', type: 'choice', required: true, meaning_label: 'profile',
          choices: ['会社員・公務員', '経営者・役員', '個人事業主・フリーランス', 'その他'] },
        { text: '漢の福袋の合宿・イベントへの参加は何回目ですか？', type: 'choice', required: true, meaning_label: 'profile',
          choices: ['今回が初めて', '2回目', '3回目以上'] },

        { text: '自由記述欄', help_text: 'その他、得た学びなどの言語化も何でも書いてください。', type: 'textarea', required: false, meaning_label: 'insight' }
      ]
    }
  }
];
