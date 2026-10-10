# 漢の福袋 アンケート

「漢の福袋」専用のアンケートSaaS。どんなアンケートを作っても**同じ形（縦持ち）でデータが貯まり**、
メールアドレスで人をまたいで回答をつなぎ、AI（Claude）が悩み・変化・成果を自動で整理します。

```
[回答者のスマホ] ──fetch POST (text/plain)──▶ [GAS ウェブアプリ] ──▶ [スプレッドシート]
 GitHub Pages                                    │ MailApp で控えを送信
  index.html  ?s=<survey_id>                     │ 10分ごとに Claude API で分析
  admin.html  （管理者キーで入る）                 ▼
                                               AI_Analysis / Tags シート
```

## フォルダ構成

| パス | 役割 |
| --- | --- |
| `index.html` / `assets/answer.js` | 回答ページ（`/?s=<survey_id>`） |
| `admin.html` / `assets/admin.js` | 管理画面（作成・編集・複製・公開/停止、回答一覧、人別、AI分析、タグ辞書、CSV） |
| `config.js` | GAS ウェブアプリのURL（秘密情報ではない） |
| `gas/` | GAS のコード（clasp の rootDir） |
| `scripts/deploy.sh` | clasp で作成→push→デプロイ→`config.js` 書き換え |
| `tests/` | GAS を Node 上でモックして動かすテスト（`npm test`） |

## データ設計（スプレッドシート）

列はアンケートが増えても変わりません。

- **Surveys**: survey_id, title, description, community, status(draft/published/closed), created_at, updated_at
- **Questions**: survey_id, question_id, order, text, help_text, type(text/textarea/choice/scale/email/name), required, choices(`|`区切り), meaning_label
- **Respondents**: respondent_id(小文字メールの SHA-256 先頭32桁), email, name, first_seen, last_seen, survey_count
- **Responses**: response_id, survey_id, respondent_id, submitted_at
- **Answers**: response_id, question_id, meaning_label, answer
- **AI_Analysis**: response_id, summary, before_state, after_state, pain_tags, change_tags, outcome_numbers, recommend_target, best_quote, analyzed_at（複数値は `|` 区切り）
- **Tags**: tag, category(pain/change/outcome), description

### 意味ラベル（全アンケート共通）

`email` メールアドレス / `name` 名前 / `pain` 参加前の悩み / `change` 変化 / `insight` 効いた体験・考え方 /
`before_after` ビフォーアフター / `outcome` 成果・数字 / `recommend` どんな人に勧めたいか /
`quote` 紹介文に使える一言 / `satisfaction` 満足度 / `request` 要望・改善点 / `profile` 属性 / `other` その他

質問を編集しても `question_id` は引き継がれるので、過去の回答とのつながりは切れません。

## 秘密情報（GAS のスクリプトプロパティにだけ置く）

| キー | 内容 |
| --- | --- |
| `ADMIN_KEY` | 管理画面に入るキー。`setup` 実行時に自動生成 |
| `ANTHROPIC_API_KEY` | Claude API キー。手動で追加（未設定でもAI分析以外は動く） |
| `SPREADSHEET_ID` | データ用スプレッドシート。`setup` 実行時に自動作成 |

## 公開手順

1. `npm i -g @google/clasp && clasp login`
2. `npm run deploy` … GAS プロジェクト作成・反映・デプロイ、`config.js` に URL を書き込み
3. 表示されたスクリプトエディタを開き、関数 `setup` を実行して権限を許可（初回のみ）
4. 「プロジェクトの設定 › スクリプト プロパティ」で `ADMIN_KEY` を確認し、`ANTHROPIC_API_KEY` を追加
5. `config.js` をコミットして push → GitHub Pages（main / ルート）で公開
6. `https://<user>.github.io/otoko-fukubukuro-survey/admin.html` に管理者キーで入り、サンプルを「公開する」

GAS のコードを直したら `npm run deploy` を再実行（同じURLのまま更新されます）。

### 現在の公開先

- ウェブアプリ: `config.js` の `API_URL`（デプロイID は `.deployment-id`）
- GAS プロジェクト: `.clasp.json` の `scriptId`

### コードを直したとき（URLを変えない更新）

clasp を使わずブラウザで更新する場合:

1. `bash scripts/bundle.sh` で `dist/Code.gs` を作り直す
2. GAS エディタの `コード.gs` を丸ごと置き換えて保存
3. 「デプロイ」→「デプロイを管理」→ 既存のデプロイの鉛筆アイコン →「バージョン：新バージョン」→「デプロイ」

「新しいデプロイ」を選ぶとURLが変わるので使わないこと。clasp を使う場合は `npm run deploy` が同じデプロイIDを更新します。

## AI分析のしくみ

- 送信は速さ優先で保存＋メールだけ行い、AI分析は **10分ごとのトリガー**（または管理画面のボタン）で行います。
- モデルは `claude-opus-5-5`。回答は意味ラベル付きで渡し、**メールアドレスは送りません**。
- 出力は JSON スキーマで固定（structured outputs）。既存タグを優先させ、新しいタグだけ Tags に自動追加。
- タグの統合・言い換えは管理画面の「タグ」タブで行えます。

## テスト

```
npm test
```
スプレッドシート・メール・Claude API をモックし、作成→公開→回答→同一人物の紐付け→編集→複製→AI分析→集計→停止 を確認します。
