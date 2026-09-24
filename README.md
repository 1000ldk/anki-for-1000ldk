# anki-for-1000ldk

自分専用の間隔反復型暗記アプリ（PWA版Anki）。iPhoneのSafariで「ホーム画面に追加」して使う。
サーバは持たず、データは端末内の IndexedDB にだけ保存する。

現在はフェーズ1（MVP）：デッキ管理、カード管理、学習、SM-2による間隔反復、1日の新規上限、バックアップ、オフライン動作。
追加機能として、カードの表・裏への画像の貼り付けに対応している（画像も端末内の IndexedDB に保存）。

## 開発

```sh
npm install
npm run dev        # 開発サーバ（Service Worker は本番ビルドのみ有効）
npm test           # 単体テスト（アルゴリズム・保存・バックアップ・画像・Markdown）
npm run build      # 型チェック + dist/ へビルド
npm run preview    # ビルド結果をローカルで確認
npm run icons      # public/icons/ のアイコンを再生成
```

スマホ実機での確認は `npm run dev -- --host` で同じLAN内から開ける（ただし Service Worker と共有シートは HTTPS が必要なので、本番URLで確認する）。

## 構成

| パス | 内容 |
| --- | --- |
| `src/scheduler.ts` | 間隔反復アルゴリズム（純粋関数。FSRSへの差し替えはここだけ） |
| `src/session.ts` | 学習セッションの出題順 |
| `src/store.ts` | IndexedDB の読み書き（Dexie） |
| `src/db.ts` | スキーマ定義。変更時は `version(n)` を追加して移行処理を書く（v2 で `media` ストアを追加） |
| `src/backup.ts` | ZIP（`data.json` + `media/`）の書き出し・読み込み（全置換／マージ）。旧形式の JSON も読める |
| `src/media.ts` | 画像の保存（SHA-256 で重複排除）、参照の抽出、不要画像の掃除、容量表示 |
| `src/image.ts`, `src/imageProcess.ts`, `src/imageWorker.ts` | 画像の縮小（長辺1600px）・再エンコード。Web Worker で処理し、使えなければメインスレッドで行う |
| `src/markdown.ts` | カード本文の Markdown（画像・太字・斜体・コード）の解析 |
| `src/ui/render.ts` | 本文の描画、画像のオブジェクトURL管理、全画面表示（ピンチで拡大） |
| `src/day.ts` | 「今日」の判定（日付の切り替わり時刻を基準） |
| `src/ui/` | 画面（ホーム・学習・デッキ詳細・カード編集・設定） |
| `src/pwa.ts`, `src/sw-template.js` | Service Worker 登録と「更新があります」表示 |
| `vite.config.ts` | ビルド時に全ファイルをキャッシュする `sw.js` を生成 |

## デプロイ（GitHub Pages + カスタムドメイン）

1. リポジトリを公開にし、Settings → Pages → Source を「GitHub Actions」にする。
2. `main` に push すると `.github/workflows/deploy.yml` がテスト・ビルドして Pages へ公開する。
3. Settings → Pages → Custom domain に `anki.1000ldk.site` を設定する。
4. Cloudflare の DNS に `anki` → `1000ldk.github.io` の CNAME を追加。プロキシは「DNSのみ」（グレーの雲）。
5. 証明書が発行されたら「Enforce HTTPS」を ON にする。

ビルドは相対パス（`base: './'`）なので、カスタムドメインでも `https://1000ldk.github.io/anki-for-1000ldk/` でも動く。

## iPhone での使い方

- Safari で開き、共有ボタン →「ホーム画面に追加」。以後はホーム画面のアイコンから起動する。
- カード編集画面の「画像を追加」から写真を選ぶ・カメラで撮るか、コピーした画像を入力欄に長押し →「ペースト」で貼り付ける。本文には `![](media:<id>)` として入る。プレビューの画像を長押しすると削除・差し替えができる。
- 学習画面で画像をタップすると全画面になり、ピンチで拡大できる。もう一度タップで閉じる。
- どのカードからも使われていない画像は、起動時（1日1回）と設定の「使われていない画像を削除」で消える。追加から24時間以内のものは残す。
- 設定 →「書き出す（ZIP）」で共有シートが開くので、「"ファイル"に保存」で iCloud Drive などに保存する。画像も含まれる。7日書き出していないとホームに催促が出る。
- 保存容量の使用量が上限の80%を超えるとホームに警告が出る。
- Anki の .apkg 取り込み（F-08）は未実装のため、.apkg 内の画像の取り込みも未対応。
- 新しいバージョンを公開すると、次回起動時に「更新があります」が出るので「反映する」をタップ。
