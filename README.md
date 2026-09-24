# anki-for-1000ldk

自分専用の間隔反復型暗記アプリ（PWA版Anki）。iPhoneのSafariで「ホーム画面に追加」して使う。
サーバは持たず、データは端末内の IndexedDB にだけ保存する。

現在はフェーズ1（MVP）：デッキ管理、カード管理、学習、SM-2による間隔反復、1日の新規上限、JSONバックアップ、オフライン動作。

## 開発

```sh
npm install
npm run dev        # 開発サーバ（Service Worker は本番ビルドのみ有効）
npm test           # 単体テスト（アルゴリズム・保存・バックアップ）
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
| `src/db.ts` | スキーマ定義。変更時は `version(n)` を追加して移行処理を書く |
| `src/backup.ts` | JSON の書き出し・読み込み（全置換／マージ） |
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
- 設定 →「書き出す」で共有シートが開くので、「"ファイル"に保存」で iCloud Drive などに保存する。7日書き出していないとホームに催促が出る。
- 新しいバージョンを公開すると、次回起動時に「更新があります」が出るので「反映する」をタップ。
