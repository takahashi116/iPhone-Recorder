# 📱 iPhone レコーダー

iPhoneブラウザで動作する録音ウェブアプリ。Google Driveへの自動保存機能付き。

## 機能

- ✅ iPhone Safari対応の録音機能
- ✅ 最大2時間の連続録音
- ✅ 画面スリープ防止（Wake Lock API）
- ✅ Google Drive連携（OAuth認証 + フォルダ選択）
- ✅ 自動アップロード機能
- ✅ オーディオビジュアライザー

## セットアップ

### 1. Google Cloud Console での設定

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 新しいプロジェクトを作成（または既存のプロジェクトを選択）
3. **APIとサービス** > **ライブラリ** で以下を有効化:
   - Google Drive API
   - Google Picker API

### 2. OAuth 2.0 認証情報の作成

1. **APIとサービス** > **認証情報** > **認証情報を作成** > **OAuth クライアント ID**
2. アプリケーションの種類: **ウェブ アプリケーション**
3. **承認済みの JavaScript 生成元** に以下を追加:
   - ローカルテスト用: `http://localhost:3000`
   - GitHub Pages用: `https://your-username.github.io`
4. クライアント ID をコピー

### 3. API キーの作成

1. **認証情報を作成** > **API キー**
2. キーを制限（推奨）:
   - アプリケーションの制限: HTTP リファラー
   - API の制限: Google Drive API, Google Picker API
3. API キー をコピー

## ローカルでのテスト

```bash
cd iphone-recorder
npx serve
```

ブラウザで `http://localhost:3000` にアクセス

## GitHub Pages へのデプロイ

1. GitHubリポジトリにプッシュ
2. Settings > Pages > Source: Deploy from a branch
3. Branch: main / root
4. Google Cloud Console で本番URLを許可リストに追加

## 使い方

1. ⚙️ API設定 を開き、Client ID と API Key を入力
2. 「設定を保存」をクリック
3. 「Googleでログイン」でアカウント認証
4. 「フォルダを選択」で保存先を設定
5. 🎤 録音開始ボタンで録音スタート！

## 注意事項

- 録音中は画面を閉じないでください
- iOS 16.4以降を推奨（Wake Lock API対応）
- 長時間録音時はデバイスを充電してください
