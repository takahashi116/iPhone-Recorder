# 🔧 Google Cloud Console セットアップ手順

iPhone録音アプリでGoogle Drive連携を有効にするための設定ガイドです。

---

## Step 1: Google Cloud Console にアクセス

1. ブラウザで [console.cloud.google.com](https://console.cloud.google.com) を開く
2. Googleアカウントでログイン

---

## Step 2: 新規プロジェクトを作成

1. 画面上部の **プロジェクト選択** ドロップダウンをクリック
2. **新しいプロジェクト** をクリック
3. 以下を入力：
   - **プロジェクト名**: `iPhone-Recorder` （任意の名前）
   - **場所**: そのまま（組織なしでOK）
4. **作成** をクリック
5. 作成完了まで数秒待つ

---

## Step 3: API を有効化

### Google Drive API
1. 左側メニュー → **APIとサービス** → **ライブラリ**
2. 検索バーに `Google Drive API` と入力
3. **Google Drive API** をクリック
4. **有効にする** をクリック

### Google Picker API
1. 再度 **ライブラリ** に戻る
2. 検索バーに `Google Picker API` と入力
3. **Google Picker API** をクリック
4. **有効にする** をクリック

---

## Step 4: OAuth 同意画面を設定

1. 左側メニュー → **APIとサービス** → **OAuth 同意画面**
2. **User Type** で **外部** を選択 → **作成**
3. **アプリ情報** を入力：
   - **アプリ名**: `iPhone Recorder`
   - **ユーザーサポートメール**: あなたのメールアドレス
   - **デベロッパーの連絡先情報**: あなたのメールアドレス
4. **保存して次へ** をクリック

### スコープの設定
5. **スコープを追加または削除** をクリック
6. フィルタに `drive.file` と入力
7. `../auth/drive.file` にチェック → **更新**
8. **保存して次へ** をクリック

### テストユーザーの追加
9. **ADD USERS** をクリック
10. 使用者のGmailアドレスを追加（複数可）
11. **保存して次へ** → **ダッシュボードに戻る**

> [!NOTE]
> **テストモードの制限**: 追加したテストユーザーのみがアプリを使用できます。
> 公開するには「アプリを公開」が必要ですが、Googleの審査に数週間かかります。

---

## Step 5: OAuth 2.0 クライアント ID を作成

1. 左側メニュー → **APIとサービス** → **認証情報**
2. 上部の **認証情報を作成** → **OAuth クライアント ID**
3. 以下を設定：
   - **アプリケーションの種類**: `ウェブ アプリケーション`
   - **名前**: `iPhone Recorder Web`
4. **承認済みの JavaScript 生成元** に以下を追加：
   ```
   http://localhost:3000
   http://localhost:5000
   https://YOUR-USERNAME.github.io
   ```
   （GitHub Pagesで公開する場合は本番URLも追加）
5. **作成** をクリック
6. 表示された **クライアント ID** をコピーして保存

```
例: 123456789-abcdefg.apps.googleusercontent.com
```

---

## Step 6: API キーを作成

1. **認証情報を作成** → **API キー**
2. API キーが生成される → **キーを制限** をクリック
3. 以下を設定：
   - **名前**: `iPhone Recorder Key`
   - **アプリケーションの制限**: `HTTP リファラー`
   - **ウェブサイトの制限** に追加：
     ```
     http://localhost:3000/*
     http://localhost:5000/*
     https://YOUR-USERNAME.github.io/*
     ```
   - **API の制限**: `キーを制限`
     - Google Drive API にチェック
     - Google Picker API にチェック
4. **保存** をクリック
5. API キーをコピーして保存

```
例: AIzaSyB1234567890abcdefg
```

---

## Step 7: アプリに設定を入力

1. ブラウザで http://localhost:3000 を開く
2. **⚙️ API設定** を展開
3. 取得した値を入力：
   - **Google Client ID**: `123456789-xxx.apps.googleusercontent.com`
   - **Google API Key**: `AIzaSyXXXX...`
4. **設定を保存** をクリック
5. **Googleでログイン** をクリック
6. 認証を完了
7. **フォルダを選択** で保存先を設定

---

## 🎉 完了！

これで録音した音声がGoogle Driveに自動保存されるようになります。

---

## トラブルシューティング

| エラー | 解決方法 |
|--------|----------|
| `invalid_client` | Client IDが正しくコピーされているか確認 |
| `origin_mismatch` | JavaScript生成元にURLを追加し忘れていないか確認 |
| `access_denied` | テストユーザーに追加されているか確認 |
| Picker が開かない | API Keyの制限でPickerAPIが許可されているか確認 |
