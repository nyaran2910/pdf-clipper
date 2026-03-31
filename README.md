# PDF Clipper - Chrome Extension

ChromeでPDFを開いた状態で、指定ページ範囲を切り出しBase64 data URIとしてクリップボードにコピーします。

## インストール

1. このフォルダを解凍（または保存）
2. Chrome で `chrome://extensions/` を開く
3. 右上「デベロッパーモード」をON
4. 「パッケージ化されていない拡張機能を読み込む」→ このフォルダを選択

## 使い方

1. ChromeでPDFを開く
2. 拡張機能アイコンをクリック
3. 開始・終了ページを入力
4. 「クリップ → コピー」ボタンを押す
5. クリップボードに `data:application/pdf;base64,...` がコピーされる

## Claude APIへの渡し方

```javascript
// コピーされたdata URIをそのままAPIに渡す例
const dataUri = /* クリップボードの内容 */;
const base64 = dataUri.split(',')[1];

await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": "YOUR_KEY",
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  },
  body: JSON.stringify({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 }
        },
        { type: "text", text: "このPDFを要約してください" }
      ]
    }]
  })
});
```

## 注意

- **ローカルPDF (`file://`)**: `chrome://extensions/` → この拡張機能 → 「ファイルのURLへのアクセスを許可する」をONに
- **認証が必要なPDF**: Cookieが同期されているため基本動作するが、CORS設定によっては取得不可
- CDN (unpkg, cdnjs) からpdf-lib / pdf.jsをロードするためインターネット接続が必要
