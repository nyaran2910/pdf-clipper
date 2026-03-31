// popup.js — PDF Clipper v2 (PNG output)
// pdf.js はHTMLで先にロード済み

const urlDisplay  = document.getElementById('urlDisplay');
const startInput  = document.getElementById('startPage');
const countInput  = document.getElementById('count');
const pageCountEl = document.getElementById('pageCount').querySelector('span');
const selectionEl = document.getElementById('selectionInfo').querySelector('span');
const clipBtn     = document.getElementById('clipBtn');
const btnText     = document.getElementById('btnText');
const statusEl    = document.getElementById('status');
const statusText  = document.getElementById('statusText');
const sizeEl      = document.getElementById('sizeEstimate');
const overlay     = document.getElementById('overlay');
const overlayText = document.getElementById('overlayText');
const progressWrap = document.getElementById('progressWrap');
const progressBar  = document.getElementById('progressBar');

let pdfDoc     = null;   // pdf.js PDFDocumentProxy
let totalPages = 0;
let pdfUrl     = null;

// pdf.js workerはローカルファイルを使用（CDN不要）
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';

// ============================================================
// INIT
// ============================================================
(async () => {
  showOverlay('PDF検出中...');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const rawUrl = tab?.url || '';

  if (!rawUrl) {
    hideOverlay();
    setStatus('error', 'タブが取得できませんでした');
    return;
  }

  // Chrome内蔵PDFビューアのURL解析
  // 形式A: chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?https://...
  // 形式B: chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/https://...  (旧形式)
  const VIEWER_ID = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
  let resolvedUrl = rawUrl;

  if (rawUrl.startsWith(VIEWER_ID)) {
    const rest = rawUrl.slice(VIEWER_ID.length);
    // "index.html?URL" or "URL" directly
    if (rest.startsWith('index.html?')) {
      resolvedUrl = rest.slice('index.html?'.length);
    } else if (rest.startsWith('?')) {
      resolvedUrl = rest.slice(1);
    } else {
      resolvedUrl = rest;
    }
  }

  const looksLikePdf =
    resolvedUrl.toLowerCase().includes('.pdf') ||
    rawUrl.includes('application/pdf') ||
    (tab.title && tab.title.toLowerCase().endsWith('.pdf'));

  if (!looksLikePdf) {
    urlDisplay.textContent = 'PDFページではありません';
    urlDisplay.className = 'url-display not-pdf';
    hideOverlay();
    setStatus('error', 'PDFが開いているタブで使用してください');
    return;
  }

  pdfUrl = resolvedUrl;
  urlDisplay.textContent = resolvedUrl.length > 50
    ? '...' + resolvedUrl.slice(-47)
    : resolvedUrl;
  urlDisplay.className = 'url-display is-pdf';

  // PDFをロード（pdf.jsで直接）
  try {
    showOverlay('PDFを読み込み中...');

    const loadingTask = pdfjsLib.getDocument({
      url: resolvedUrl,
      withCredentials: true,   // Notion等のCookieを送信
    });

    // 進捗表示
    loadingTask.onProgress = (p) => {
      if (p.total > 0) {
        const pct = Math.round((p.loaded / p.total) * 100);
        showOverlay(`PDFを読み込み中... ${pct}%`);
      }
    };

    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;

    pageCountEl.textContent = totalPages;
    startInput.max = totalPages;
    countInput.max   = totalPages;

    // 現在ページ検出
    const currentPage = await detectCurrentPage(tab, totalPages);
    startInput.value = currentPage;
    countInput.value = currentPage;

    updateSelectionInfo();
    clipBtn.disabled = false;
    hideOverlay();

    // ★ フォーカスを開始ページ選択ボックスに
    startInput.focus();
    startInput.select();

  } catch (e) {
    hideOverlay();
    setStatus('error', 'PDF読み込み失敗: ' + summarizeError(e));
  }
})();

// ============================================================
// 現在ページ検出
// Chrome PDFビューアのDOMには直接アクセス不可（別拡張のchrome-extension://）
// なのでURLハッシュのみ使用、取れなければ1
// ============================================================
async function detectCurrentPage(tab, total) {
  // URLハッシュ: #page=N または #N
  try {
    const fullUrl = tab.url;
    // chrome-extension viewer の場合、クエリパラメータ部分のhashを見る
    const hashIdx = fullUrl.lastIndexOf('#');
    if (hashIdx !== -1) {
      const hash = fullUrl.slice(hashIdx);
      const m = hash.match(/page[=:](\d+)|#(\d+)$|[?&]page=(\d+)/i);
      if (m) {
        const n = parseInt(m[1] || m[2] || m[3]);
        if (n >= 1 && n <= total) return n;
      }
    }
  } catch (_) {}

  // chrome.scripting で PDF viewer ページのDOMを読む試み
  // ※ chrome-extension:// のページはスクリプト注入できないため
  //   通常のHTTPSタブ上で動くPDF.js viewerにのみ有効
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // chrome-extension:// URLへのscripting注入はスキップ
    if (activeTab.url.startsWith('chrome-extension://')) return 1;
    if (activeTab.url.startsWith('chrome://')) return 1;

    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        // PDF.js standalone viewer (Webページに埋め込まれたケース)
        if (window.PDFViewerApplication && window.PDFViewerApplication.page > 0) {
          return window.PDFViewerApplication.page;
        }
        // Shadow DOM を再帰的に探索
        function shadowQuery(root, sel) {
          try { const el = root.querySelector(sel); if (el) return el; } catch (_) {}
          try {
            for (const n of root.querySelectorAll('*')) {
              if (n.shadowRoot) { const f = shadowQuery(n.shadowRoot, sel); if (f) return f; }
            }
          } catch (_) {}
          return null;
        }
        for (const sel of ['input#page-selector', 'viewer-page-selector input', '#pageNumber', 'input[aria-label*="page" i]']) {
          const el = shadowQuery(document, sel);
          if (el) { const v = parseInt(el.value); if (v >= 1) return v; }
        }
        return null;
      }
    });
    const val = results?.[0]?.result;
    if (val && val >= 1 && val <= total) return val;
  } catch (_) {}

  return 1;
}

// ============================================================
// EVENTS
// ============================================================
startInput.addEventListener('input', updateSelectionInfo);
countInput.addEventListener('input', updateSelectionInfo);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !clipBtn.disabled && document.activeElement !== startInput && document.activeElement !== countInput) {
    clipBtn.click();
  }
});

// inputでEnterを押したときも次のフィールドに移動 or 実行
startInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { countInput.focus(); countInput.select(); }
});
countInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { clipBtn.focus(); clipBtn.click(); }
});

clipBtn.addEventListener('click', async () => {
  const start = parseInt(startInput.value);
  const end   = start + parseInt(countInput.value) - 1;
  if (!validate(start, end)) return;

  setLoading(true);
  hideStatus();
  showProgress(0);

  try {
    const png = await renderPagesToPng(start, end, (done, total) => {
      showProgress(Math.round((done / total) * 100));
    });

    // クリップボードにPNG書き込み
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': png })
    ]);

    const kb = Math.round(png.size / 1024);
    sizeEl.textContent = kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;
    setStatus('success',
      `p.${start}${start !== end ? '–' + end : ''} をPNGでコピーしました`
      + (kb < 1024 ? `  ·  ${kb} KB` : `  ·  ${(kb/1024).toFixed(1)} MB`)
    );
  } catch (e) {
    setStatus('error', summarizeError(e));
  } finally {
    setLoading(false);
    hideProgress();
    clipBtn.focus();
  }
});

// ============================================================
// PDF → PNG レンダリング
// 複数ページは縦に結合した1枚のPNGを生成
// ============================================================
async function renderPagesToPng(startPage, endPage, onProgress) {
  const SCALE = 2.0; // 144dpi相当

  // 全ページをcanvasに描画して収集
  const canvases = [];
  let totalWidth = 0;
  let totalHeight = 0;

  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: SCALE });

    const canvas = document.createElement('canvas');
    canvas.width  = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    canvases.push(canvas);
    totalWidth  = Math.max(totalWidth, canvas.width);
    totalHeight += canvas.height;

    onProgress(pageNum - startPage + 1, endPage - startPage + 1);
  }

  // 1枚に縦結合
  const merged = document.createElement('canvas');
  merged.width  = totalWidth;
  merged.height = totalHeight;
  const mctx = merged.getContext('2d');

  // 白背景
  mctx.fillStyle = '#ffffff';
  mctx.fillRect(0, 0, totalWidth, totalHeight);

  let y = 0;
  for (const c of canvases) {
    // 中央揃え（幅が違うページが混在するケース対応）
    const x = Math.floor((totalWidth - c.width) / 2);
    mctx.drawImage(c, x, y);
    y += c.height;
  }

  return new Promise((resolve, reject) => {
    merged.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG生成に失敗しました'));
    }, 'image/png');
  });
}

// ============================================================
// HELPERS
// ============================================================
function updateSelectionInfo() {
  const s = parseInt(startInput.value) || 0;
  const e = parseInt(countInput.value) || 0;
  if (s >= 1 && e >= 1 && s + e - 1 <= totalPages) {
    selectionEl.textContent = "有効";
  } else {
    selectionEl.textContent = '無効';
  }
}

function validate(start, end) {
  if (isNaN(start) || isNaN(end))  { setStatus('error', 'ページ番号を入力してください'); return false; }
  if (start < 1 || end < 1)        { setStatus('error', 'ページ番号は1以上'); return false; }
  if (start > end)                  { setStatus('error', '開始 ≤ 終了 になるよう設定してください'); return false; }
  if (end > totalPages)             { setStatus('error', `最大ページは ${totalPages}`); return false; }
  return true;
}

function setLoading(on) {
  clipBtn.disabled = on;
  if (on) {
    clipBtn.classList.add('loading');
    btnText.innerHTML = '<div class="spinner"></div> レンダリング中...';
  } else {
    clipBtn.classList.remove('loading');
    btnText.textContent = 'PNG でコピー [Enter]';
  }
}

function setStatus(type, msg) { statusEl.className = 'status show ' + type; statusText.textContent = msg; }
function hideStatus()         { statusEl.className = 'status'; }

function showProgress(pct) { progressWrap.classList.add('show'); progressBar.style.width = pct + '%'; }
function hideProgress()    { progressWrap.classList.remove('show'); progressBar.style.width = '0%'; }

function showOverlay(msg)  { overlayText.textContent = msg; overlay.classList.add('show'); }
function hideOverlay()     { overlay.classList.remove('show'); }

function summarizeError(e) {
  const msg = e?.message || String(e);
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'ネットワークエラー (CORS / 認証の可能性あり)';
  if (msg.includes('403')) return '403: アクセス権限がありません';
  if (msg.includes('401')) return '401: 再ログインが必要かもしれません';
  if (msg.includes('Missing PDF')) return 'PDFが取得できませんでした';
  if (msg.includes('clipboard')) return 'クリップボードへの書き込みに失敗しました（ポップアップを閉じずに実行してください）';
  return msg.slice(0, 120);
}
