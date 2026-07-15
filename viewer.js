const content = document.getElementById("content");
const preview = document.getElementById("preview");
const fontSelect = document.getElementById("fontSelect");
const sizeRange = document.getElementById("sizeRange");
const sizeVal = document.getElementById("sizeVal");
const themeSelect = document.getElementById("themeSelect");
const previewBtn = document.getElementById("previewBtn");
const copyBtn = document.getElementById("copyBtn");
const printBtn = document.getElementById("printBtn");
const clearBtn = document.getElementById("clearBtn");
const urlInput = document.getElementById("urlInput");
const loadUrlBtn = document.getElementById("loadUrlBtn");
const toast = document.getElementById("toast");

let previewMode = false;

// ---------- تم (روشن/تاریک/سیستم) ----------
function applyTheme(theme) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

chrome.storage.local.get({ theme: "system" }, (data) => {
  themeSelect.value = data.theme;
  applyTheme(data.theme);
});

themeSelect.addEventListener("change", () => {
  chrome.storage.local.set({ theme: themeSelect.value });
  applyTheme(themeSelect.value);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.theme) {
    themeSelect.value = changes.theme.newValue;
    applyTheme(changes.theme.newValue);
  }
});

// ---------- متن ذخیره‌شده رو بخون و نشون بده ----------
chrome.storage.local.get({ viewerText: "", viewerPreview: false, selectedFont: "Vazirmatn" }, (data) => {
  if (data.viewerText) {
    content.textContent = data.viewerText;
    // بعد از نمایش، پاکش کن که دفعه بعد تب خالی باز بشه
    chrome.storage.local.remove(["viewerText", "viewerPreview"]);
  }
  // فونت پیش‌فرض همون فونتی باشه که کاربر انتخاب کرده
  const font = data.selectedFont === "system" ? "Vazirmatn" : data.selectedFont;
  fontSelect.value = font;
  applyFont(font);
  if (data.viewerText && data.viewerPreview) {
    setPreviewMode(true);
  } else {
    content.focus();
  }
});

function applyFont(font) {
  const family = `'${font}', Tahoma, sans-serif`;
  content.style.fontFamily = family;
  preview.style.fontFamily = family;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

// ============================================
// تبدیل مارک‌داون به HTML (ساده، بدون کتابخونه)
// بلاک‌ها و کدهای درون‌خطی همیشه چپ‌به‌راست نمایش داده میشن
// ============================================
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(escapedText) {
  let t = escapedText;
  t = t.replace(/`([^`]+?)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__([^_]+?)__/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*]+?)\*/g, "<em>$1</em>");
  t = t.replace(/(^|[^\w])_([^_]+?)_(?!\w)/g, "$1<em>$2</em>");
  t = t.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return t;
}

// جدول‌های مارک‌داون: | سلول | سلول | ... با ردیف جداکننده‌ی |---|---|
function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}
function isTableSeparatorRow(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}
function cellAlignAttr(marker) {
  if (!marker) return "";
  const left = marker.startsWith(":");
  const right = marker.endsWith(":");
  if (left && right) return ' style="text-align:center"';
  if (right) return ' style="text-align:right"';
  if (left) return ' style="text-align:left"';
  return "";
}

function renderMarkdown(raw) {
  // بلاک‌های کد فنس‌شده رو جدا نگه می‌داریم تا پردازش‌های بعدی روشون اثر نذاره
  const codeBlocks = [];
  const withPlaceholders = raw.replace(
    /```([^\n`]*)\n([\s\S]*?)```/g,
    (match, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang.trim(), code: code.replace(/\n$/, "") });
      return ` CB${idx} `;
    }
  );
  const lines = withPlaceholders.split(/\r\n|\r|\n/);
  return processLines(lines, codeBlocks).join("\n");
}

// روی یک آرایه از خط‌ها پردازش می‌کنه؛ برای محتوای داخل blockquote هم بازگشتی صدا زده میشه
// تا لیست/پاراگراف تودرتوی داخل نقل‌قول هم درست رندر بشه
function processLines(lines, codeBlocks) {
  const html = [];
  let list = null; // { type: 'ul' | 'ol', items: [], start }
  let para = [];
  let quoteBuf = null; // خط‌های خام (بدون escape) داخل یک بلاک نقل‌قول چندخطی

  function flushPara() {
    if (para.length) {
      html.push(`<p>${para.join("<br>")}</p>`);
      para = [];
    }
  }
  function flushList() {
    if (list) {
      const items = list.items.map((i) => `<li>${i}</li>`).join("");
      const startAttr = list.type === "ol" && list.start && list.start !== 1 ? ` start="${list.start}"` : "";
      html.push(`<${list.type}${startAttr}>${items}</${list.type}>`);
      list = null;
    }
  }
  function flushQuote() {
    if (quoteBuf) {
      const inner = processLines(quoteBuf, codeBlocks).join("\n");
      html.push(`<blockquote>${inner}</blockquote>`);
      quoteBuf = null;
    }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];

    const cb = rawLine.match(/^ CB(\d+) $/);
    if (cb) {
      flushPara();
      flushList();
      flushQuote();
      const { lang, code } = codeBlocks[Number(cb[1])];
      const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      html.push(
        `<pre class="code-block" dir="ltr"><code${langClass}>${escapeHtml(code)}</code></pre>`
      );
      continue;
    }

    // خط‌های پشت سر هم که با > شروع میشن، یک بلاک نقل‌قول واحد میشن (نه جدا جدا)
    const quoteMatch = rawLine.match(/^\s{0,3}>\s?(.*)$/);
    if (quoteMatch) {
      flushPara();
      flushList();
      if (!quoteBuf) quoteBuf = [];
      quoteBuf.push(quoteMatch[1]);
      continue;
    }
    flushQuote();

    // جدول: خط فعلی حداقل یک | داره و خط بعدی ردیف جداکننده‌ست
    if (
      rawLine.includes("|") &&
      rawLine.trim() !== "" &&
      idx + 1 < lines.length &&
      isTableSeparatorRow(lines[idx + 1])
    ) {
      flushPara();
      flushList();
      const headerCells = splitTableRow(rawLine);
      const aligns = splitTableRow(lines[idx + 1]);
      idx += 2;
      const bodyRows = [];
      while (idx < lines.length && lines[idx].includes("|") && lines[idx].trim() !== "") {
        bodyRows.push(splitTableRow(lines[idx]));
        idx++;
      }
      idx--; // برای اینکه idx++ خودِ حلقه‌ی for روی خط درست بعدی بیفته
      const thead = `<tr>${headerCells
        .map((c, i) => `<th${cellAlignAttr(aligns[i])}>${renderInline(escapeHtml(c))}</th>`)
        .join("")}</tr>`;
      const tbody = bodyRows
        .map(
          (row) =>
            `<tr>${row
              .map((c, i) => `<td${cellAlignAttr(aligns[i])}>${renderInline(escapeHtml(c))}</td>`)
              .join("")}</tr>`
        )
        .join("");
      html.push(
        `<div class="table-wrap"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`
      );
      continue;
    }

    const line = escapeHtml(rawLine);
    const trimmed = line.trim();

    if (trimmed === "") {
      flushPara();
      flushList();
      continue;
    }

    let m;
    if ((m = trimmed.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara();
      flushList();
      const level = m[1].length;
      html.push(`<h${level}>${renderInline(m[2])}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      flushList();
      html.push("<hr>");
      continue;
    }
    if ((m = trimmed.match(/^[-*]\s+(.*)$/))) {
      flushPara();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(renderInline(m[1]));
      continue;
    }
    if ((m = trimmed.match(/^(\d+)\.\s+(.*)$/))) {
      flushPara();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [], start: Number(m[1]) };
      }
      list.items.push(renderInline(m[2]));
      continue;
    }

    flushList();
    para.push(renderInline(line));
  }
  flushPara();
  flushList();
  flushQuote();

  return html;
}

// ---------- سوییچ حالت ویرایش / پیش‌نمایش ----------
function setPreviewMode(isPreview) {
  previewMode = isPreview;
  if (isPreview) {
    preview.innerHTML = renderMarkdown(content.innerText);
    content.classList.add("hidden");
    preview.classList.add("visible");
    previewBtn.textContent = "✏️ ویرایش متن";
    previewBtn.classList.add("active");
  } else {
    content.classList.remove("hidden");
    preview.classList.remove("visible");
    previewBtn.textContent = "👁️ پیش‌نمایش مارک‌داون";
    previewBtn.classList.remove("active");
    content.focus();
  }
}

previewBtn.addEventListener("click", () => setPreviewMode(!previewMode));

// ---------- کنترل‌ها ----------
fontSelect.addEventListener("change", () => applyFont(fontSelect.value));

sizeRange.addEventListener("input", () => {
  content.style.fontSize = sizeRange.value + "px";
  preview.style.fontSize = sizeRange.value + "px";
  sizeVal.textContent = sizeRange.value;
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(content.innerText);
    showToast("متن کپی شد ✅");
  } catch {
    showToast("کپی نشد ❌");
  }
});

printBtn.addEventListener("click", () => window.print());

clearBtn.addEventListener("click", () => {
  content.textContent = "";
  if (previewMode) setPreviewMode(true);
  content.focus();
});

// وقتی paste میشه، فقط متن ساده بیاد (بدون استایل‌های سایت مبدا)
content.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = e.clipboardData.getData("text/plain");
  document.execCommand("insertText", false, text);
});

// ============================================
// بارگذاری فایل .md از یک آدرس (اینترنت یا لوکال‌هاست)
// ============================================
async function loadFromUrl() {
  const raw = urlInput.value.trim();
  if (!raw) return;

  // مسیرهای فایل ویندوزی مثل E:\... یا \\server\share\... یا file:///
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(raw) || /^\\\\/.test(raw);
  if (isWindowsPath || raw.startsWith("file:")) {
    showToast("مسیر فایل سیستم پشتیبانی نمی‌شه؛ محتوای فایل رو کپی و پیست کن ❌");
    return;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    showToast("آدرس نامعتبره ❌");
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    showToast("فقط آدرس‌های http:// و https:// پشتیبانی می‌شن ❌");
    return;
  }

  loadUrlBtn.disabled = true;
  const originalLabel = loadUrlBtn.textContent;
  loadUrlBtn.textContent = "⏳ در حال بارگذاری...";

  try {
    const res = await fetch(parsed.href, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    content.textContent = text;
    setPreviewMode(true);
    showToast("فایل با موفقیت بارگذاری شد ✅");
  } catch (err) {
    showToast(`بارگذاری ناموفق بود ❌ (${err.message || "خطای شبکه"})`);
  } finally {
    loadUrlBtn.disabled = false;
    loadUrlBtn.textContent = originalLabel;
  }
}

loadUrlBtn.addEventListener("click", loadFromUrl);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadFromUrl();
});
