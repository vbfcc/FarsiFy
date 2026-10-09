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
const mdFileInput = document.getElementById("mdFileInput");
const loadFileBtn = document.getElementById("loadFileBtn");
const mdFolderInput = document.getElementById("mdFolderInput");
const loadFolderBtn = document.getElementById("loadFolderBtn");
const fileHeader = document.getElementById("fileHeader");
const fileChipList = document.getElementById("fileChipList");
const currentFileControl = document.getElementById("currentFileControl");
const currentFileNameEl = document.getElementById("currentFileName");
const permBanner = document.getElementById("permBanner");
const permBannerText = document.getElementById("permBannerText");
const permRetryBtn = document.getElementById("permRetryBtn");
const toast = document.getElementById("toast");
const selToolbar = document.getElementById("selToolbar");
const selLtrBtn = document.getElementById("selLtrBtn");
const selCodeBtn = document.getElementById("selCodeBtn");

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

// ---------- نام فایلی که همین الان در حال خواندنشیم، در هدر و عنوان تب نشون بده ----------
function setCurrentFileName(name) {
  if (!name) {
    currentFileNameEl.textContent = "";
    currentFileNameEl.title = "";
    currentFileControl.classList.remove("visible");
    document.title = "متن راست‌چین";
    return;
  }
  currentFileNameEl.textContent = name;
  currentFileNameEl.title = name;
  currentFileControl.classList.add("visible");
  document.title = `${name} — فارسی‌فای`;
}

function fileNameFromUrl(parsedUrl) {
  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  const last = segments.pop();
  try {
    return last ? decodeURIComponent(last) : parsedUrl.hostname;
  } catch {
    return last || parsedUrl.hostname;
  }
}

// ============================================
// آدرس تبِ ویوئر: منبع سند فعلی (لینک یا هندلِ فایل/پوشه‌ی لوکال) رو توی
// query string نگه می‌داره تا هم اسم فایل توی آدرس‌بار معلوم باشه، هم با
// رفرش کردن همون تب، آخرین نسخه‌ی سند از همون منبع دوباره خونده بشه
// ============================================
function setAddressParams(params) {
  ReaderTools.addressChanged(params);
  const qs = new URLSearchParams(params).toString();
  history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
}

// ---------- ذخیره‌ی هندل‌های File System Access API در IndexedDB ----------
// (بین تب‌های مختلف همین اکستنشن مشترکه، پس با «باز کردن در تب جدید» هم قابل استفاده‌ست)
const HANDLE_DB_NAME = "farsify-file-handles";
const HANDLE_STORE = "handles";

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(id, handle) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle(id) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const req = tx.objectStore(HANDLE_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function genHandleId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// اول بی‌صدا امتحان می‌کنه (اگه اجازه‌ی قبلی هنوز معتبره). اگه بعد از رفرشِ تب
// (بدون user gesture) درخواستِ بی‌صدا رد بشه، یک بنر با دکمه نشون می‌ده تا با
// یک کلیک (که خودش gesture حساب میشه) دوباره امتحان کنه
async function ensureReadPermission(handle) {
  const opts = { mode: "read" };
  try {
    if ((await handle.queryPermission(opts)) === "granted") return true;
  } catch {
    return false;
  }
  try {
    if ((await handle.requestPermission(opts)) === "granted") return true;
  } catch {
    // نادیده بگیر، بریم سراغ روش دستی
  }
  return askPermissionWithClick(handle);
}

function askPermissionWithClick(handle) {
  return new Promise((resolve) => {
    permBannerText.textContent = "برای بارگذاری این فایل/پوشه‌ی لوکال، دوباره اجازه‌ی دسترسی لازمه.";
    permBanner.classList.add("visible");
    const onClick = async () => {
      permRetryBtn.removeEventListener("click", onClick);
      permBanner.classList.remove("visible");
      let granted = false;
      try {
        granted = (await handle.requestPermission({ mode: "read" })) === "granted";
      } catch {
        granted = false;
      }
      resolve(granted);
    };
    permRetryBtn.addEventListener("click", onClick);
  });
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

// ---------- رنگ‌بندی ساده‌ی نحوی داخل بلوک‌های کد ----------
const CODE_KEYWORDS =
  "if|else|elseif|endif|foreach|endforeach|while|endwhile|for|endfor|do|switch|case|default|break|continue|" +
  "return|function|fn|class|interface|trait|extends|implements|public|private|protected|static|final|abstract|" +
  "const|new|use|namespace|try|catch|finally|throw|yield|global|instanceof|echo|print|true|false|null|void|" +
  "let|var|async|await|export|import|typeof|in|of|and|or|not";

const CODE_TOKEN_RE = new RegExp(
  "(\\/\\/[^\\n]*|#[^\\n]*)" + // 1: comment
  "|(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')" + // 2: string
  "|(\\$[A-Za-z_]\\w*)" + // 3: variable
  "|\\b(" + CODE_KEYWORDS + ")\\b" + // 4: keyword
  "|\\b(\\d+(?:\\.\\d+)?)\\b" + // 5: number
  "|([A-Za-z_]\\w*)(?=\\s*\\()", // 6: function call
  "g"
);

function highlightCode(raw) {
  let result = "";
  let lastIndex = 0;
  let m;
  CODE_TOKEN_RE.lastIndex = 0;
  while ((m = CODE_TOKEN_RE.exec(raw)) !== null) {
    result += escapeHtml(raw.slice(lastIndex, m.index));
    const [full, comment, string, variable, keyword, number, funcCall] = m;
    let type = "func";
    if (comment) type = "comment";
    else if (string) type = "string";
    else if (variable) type = "var";
    else if (keyword) type = "keyword";
    else if (number) type = "num";
    result += `<span class="tok-${type}">${escapeHtml(full)}</span>`;
    lastIndex = CODE_TOKEN_RE.lastIndex;
  }
  result += escapeHtml(raw.slice(lastIndex));
  return result;
}

function renderCodeBlockHtml(lang, code) {
  const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
  const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  return `<pre class="code-block"${langAttr} dir="ltr"><code${langClass}>${highlightCode(code)}</code></pre>`;
}

function renderInline(escapedText) {
  // Protect code and generated HTML so emphasis never modifies paths or attributes.
  const tokens = [];
  const store = (html) => { tokens.push(html); return `\x00INLINE${tokens.length - 1}\x00`; };
  const decode = (text) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  let t = escapedText.replace(/`([^`]+?)`/g, (_, code) => store(`<code>${code}</code>`));
  t = t.replace(/(!?)\[([^\]]*)\]\((<[^>]*>|&lt;[\s\S]*?&gt;|(?:[^\s()]|\([^()]*\))+)(?:\s+&quot;([\s\S]*?)&quot;)?\)/g,
    (match, image, label, destination, title) => {
      let path = decode(destination);
      if (path.startsWith("<") && path.endsWith(">")) path = path.slice(1, -1);
      const href = DocumentResources.link(path);
      if (!href) return store(label); // Unsafe schemes never reach an href or src.
      const attrs = `href="${escapeHtml(href)}" data-reference="${escapeHtml(path)}" target="_blank" rel="noopener noreferrer"`;
      const titleAttr = title ? ` title="${title}"` : "";
      if (image || SourcePaths.isImage(path)) {
        return store(`<a ${attrs}${titleAttr}><img class="document-image" data-source="${escapeHtml(path)}" alt="${label}"${titleAttr} loading="lazy"></a>`);
      }
      const restoredLabel = label.replace(/\x00INLINE(\d+)\x00/g, (_, index) => tokens[Number(index)]);
      return store(`<a ${attrs}${titleAttr}>${restoredLabel}</a>`);
    });
  t = t.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__([^_]+?)__/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*]+?)\*/g, "<em>$1</em>");
  t = t.replace(/(^|[^\w])_([^_]+?)_(?!\w)/g, "$1<em>$2</em>");
  return t.replace(/\x00INLINE(\d+)\x00/g, (_, index) => tokens[Number(index)]);
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
  raw = TaskLists.prepare(raw);
  // بلاک‌های کد فنس‌شده رو جدا نگه می‌داریم تا پردازش‌های بعدی روشون اثر نذاره
  const codeBlocks = [];
  let working = raw.replace(
    /```([^\n`]*)\n([\s\S]*?)```/g,
    (match, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang.trim(), code: code.replace(/\n$/, "") });
      return ` CB${idx} `;
    }
  );
  // Remove direction wrappers after protecting code examples containing these tags.
  working = working.replace(/^\s*<div\s+dir=["'](?:rtl|ltr)["']\s*>\s*$/gim, "").replace(/^\s*<\/div>\s*$/gim, "");

  // بخش‌های [ltr]...[/ltr] (متنی که کاربر با تولبار انتخاب علامت زده) رو هم
  // جدا نگه می‌داریم تا escapeHtml و پردازش خط‌به‌خط بهشون کاری نداشته باشه
  const ltrBlocks = [];
  working = working.replace(/\[ltr\]([\s\S]+?)\[\/ltr\]/gi, (match, text) => {
    const idx = ltrBlocks.length;
    ltrBlocks.push(text);
    return `\x00LTR${idx}\x00`;
  });

  const lines = working.split(/\r\n|\r|\n/);
  let html = processLines(lines, codeBlocks).join("\n");

  html = html.replace(/\x00LTR(\d+)\x00/g, (match, idx) => {
    const inner = renderLtrContent(ltrBlocks[Number(idx)], codeBlocks);
    return `<span class="ltr-inline" dir="ltr">${inner}</span>`;
  });

  const headingIds = new Map();
  html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_, level, inner) => {
    const slug = inner.replace(/<[^>]+>/g, "").replace(/&[a-z#\d]+;/gi, "").trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-") || "section";
    const count = headingIds.get(slug) || 0;
    headingIds.set(slug, count + 1);
    return `<h${level} id="${escapeHtml(slug + (count ? `-${count}` : ""))}">${inner}</h${level}>`;
  });

  return html;
}

// محتوای داخل [ltr]...[/ltr] ممکنه خودش یک بلوک کد فنس‌شده (که قبلاً به CBn جایگزین شده) داشته باشه؛
// این تابع آن‌ها را به‌صورت بلوک کد واقعی برمی‌گردونه و بقیه‌ی متن رو escape و به <br> تبدیل می‌کنه
function renderLtrContent(text, codeBlocks) {
  return text
    .split(/( CB\d+ )/g)
    .map((part) => {
      const m = part.match(/^ CB(\d+) $/);
      if (m) {
        const { lang, code } = codeBlocks[Number(m[1])];
        return renderCodeBlockHtml(lang, code);
      }
      return renderInline(escapeHtml(part)).replace(/\r\n|\r|\n/g, "<br>");
    })
    .join("");
}

function listMarker(line) {
  const match = line.match(/^( *)([-+*]|\d+[.)]) +(.*)$/);
  if (!match) return null;
  return {
    indent: match[1].length,
    contentIndent: line.length - match[3].length,
    type: /^\d/.test(match[2]) ? "ol" : "ul",
    start: parseInt(match[2], 10),
    text: match[3]
  };
}

// Keep continuation paragraphs and nested lists inside their parent list item.
function renderList(lines, start, codeBlocks) {
  const first = listMarker(lines[start]);
  const items = [];
  let index = start;
  while (index < lines.length) {
    const marker = listMarker(lines[index]);
    if (!marker || marker.indent !== first.indent || marker.type !== first.type) break;
    const task = marker.text.match(/^\x00TASK(\d+):([01])\x00\s*(.*)$/);
    const itemLines = [task ? task[3] : marker.text];
    index++;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        let next = index + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        const nextMarker = listMarker(lines[next] || "");
        if (nextMarker?.indent === first.indent) { index = next; break; }
        const nextIndent = (lines[next] || "").match(/^ */)[0].length;
        if (next < lines.length && nextIndent >= marker.contentIndent) {
          itemLines.push("");
          index++;
          continue;
        }
        break;
      }
      const nextMarker = listMarker(line);
      if (nextMarker && nextMarker.indent <= first.indent) break;
      const indent = line.match(/^ */)[0].length;
      if (indent >= marker.contentIndent) {
        itemLines.push(line.slice(marker.contentIndent));
      } else {
        // Markdown permits an unindented continuation of a list paragraph.
        if (nextMarker || /^(?:#{1,6}\s|>|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$| *CB\d+ *$)/.test(line)) break;
        itemLines.push(line);
      }
      index++;
    }
    const inner = processLines(itemLines, codeBlocks).join("\n");
    if (task) {
      items.push(`<li class="task-item"><input type="checkbox" class="task-checkbox" data-task-offset="${task[1]}"${task[2] === "1" ? " checked" : ""} aria-label="${escapeHtml(task[3] || "تغییر وضعیت مورد")}"><div class="task-body">${inner}</div></li>`);
    } else items.push(`<li>${inner}</li>`);
  }
  const startAttr = first.type === "ol" && first.start !== 1 ? ` start="${first.start}"` : "";
  return { html: `<${first.type}${startAttr}>${items.join("")}</${first.type}>`, next: index };
}

// روی یک آرایه از خط‌ها پردازش می‌کنه؛ برای محتوای داخل blockquote هم بازگشتی صدا زده میشه
// تا لیست/پاراگراف تودرتوی داخل نقل‌قول هم درست رندر بشه
function processLines(lines, codeBlocks) {
  const html = [];
  let para = [];
  let quoteBuf = null; // خط‌های خام (بدون escape) داخل یک بلاک نقل‌قول چندخطی

  function flushPara() {
    if (para.length) {
      html.push(`<p>${para.join("<br>")}</p>`);
      para = [];
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

    const cb = rawLine.match(/^ *CB(\d+) *$/);
    if (cb) {
      flushPara();
      flushQuote();
      const { lang, code } = codeBlocks[Number(cb[1])];
      html.push(renderCodeBlockHtml(lang, code));
      continue;
    }

    // خط‌های پشت سر هم که با > شروع میشن، یک بلاک نقل‌قول واحد میشن (نه جدا جدا)
    const quoteMatch = rawLine.match(/^\s{0,3}>\s?(.*)$/);
    if (quoteMatch) {
      flushPara();
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
      continue;
    }

    let m;
    if ((m = trimmed.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara();
      const level = m[1].length;
      html.push(`<h${level}>${renderInline(m[2])}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      html.push("<hr>");
      continue;
    }
    if (listMarker(rawLine)) {
      flushPara();
      const list = renderList(lines, idx, codeBlocks);
      html.push(list.html);
      idx = list.next - 1;
      continue;
    }

    para.push(renderInline(line));
  }
  flushPara();
  flushQuote();

  return html;
}

// ---------- سوییچ حالت ویرایش / پیش‌نمایش ----------
function setPreviewMode(isPreview) {
  previewMode = isPreview;
  if (isPreview) {
    preview.innerHTML = DocumentResources.render(content.innerText);
    content.classList.add("hidden");
    preview.classList.add("visible");
    previewBtn.textContent = "✏️ ویرایش متن";
    previewBtn.classList.add("active");
    hideSelToolbar();
    ReaderTools.decorate();
    return DocumentResources.hydrate(preview);
  } else {
    content.classList.remove("hidden");
    preview.classList.remove("visible");
    previewBtn.textContent = "👁️ پیش‌نمایش مارک‌داون";
    previewBtn.classList.remove("active");
    content.focus();
    ReaderTools.updateOutline();
  }
}

previewBtn.addEventListener("click", () => {
  setPreviewMode(!previewMode);
  if (ReaderTools.isDraft()) ReaderTools.save();
});

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
  const existingDraft = new URLSearchParams(location.search).get("draft");
  content.textContent = "";
  DocumentResources.set({});
  setAddressParams(existingDraft ? { draft: existingDraft } : {});
  if (previewMode) setPreviewMode(true);
  setCurrentFileName(null);
  activeFolderFileIdx = -1;
  renderFileHeader();
  setPreviewMode(false);
  ReaderTools.save();
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
// آدرس منبع رو توی query string تب می‌ذاره (src=...) تا هم اسمش توی آدرس‌بار
// دیده بشه، هم با رفرش همین تب دوباره از همون آدرس (نسخه‌ی تازه) خونده بشه
async function fetchAndLoadUrl(href, { updateAddress = true } = {}) {
  loadUrlBtn.disabled = true;
  const originalLabel = loadUrlBtn.textContent;
  loadUrlBtn.textContent = "⏳ در حال بارگذاری...";

  try {
    const ref = SourcePaths.resolve(href);
    if (!ref || ref.kind !== "url") throw new Error("آدرس نامعتبر است.");
    const file = await DocumentResources.fileFor(ref);
    const text = SourcePaths.isImage(ref.url) ? "" : await file.text();
    const params = new URLSearchParams(location.search);
    const target = updateAddress ? { ...ref, anchor: ref.fragment } : { line: params.get("line") || ref.line, endLine: params.get("endLine") || ref.endLine, column: params.get("column") || ref.column, anchor: params.get("anchor") || ref.fragment };
    DocumentResources.set({ url: ref.url, name: fileNameFromUrl(new URL(ref.url)) }, target);
    content.textContent = text;
    setPreviewMode(true);
    setCurrentFileName(fileNameFromUrl(new URL(ref.url)));
    currentFolderHandleId = null;
    activeFolderFileIdx = -1;
    renderFileHeader();
    if (updateAddress) setAddressParams(Object.fromEntries(new URLSearchParams(SourcePaths.viewerParams(ref))));
    showToast("فایل با موفقیت بارگذاری شد ✅");
    return true;
  } catch (err) {
    DocumentResources.warn(err.message);
    showToast(`بارگذاری ناموفق بود ❌ (${err.message || "خطای شبکه"})`);
    return false;
  } finally {
    loadUrlBtn.disabled = false;
    loadUrlBtn.textContent = originalLabel;
  }
}

async function loadFromUrl() {
  const raw = urlInput.value.trim();
  if (!raw) return;

  let parsed;
  try {
    const ref = SourcePaths.parseReference(raw);
    parsed = SourcePaths.inputUrl(ref.path);
    await fetchAndLoadUrl(parsed.href + (ref.line ? `#L${ref.line}${ref.endLine !== ref.line ? `-L${ref.endLine}` : ""}${ref.column ? `:${ref.column}` : ""}` : ref.fragment ? "#" + ref.fragment : ""));
  } catch {
    showToast("آدرس نامعتبره ❌");
    return;
  }
}

loadUrlBtn.addEventListener("click", loadFromUrl);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadFromUrl();
});

// صفحه با ?src=<آدرس> باز شده (بارگذاری اولیه یا رفرش تبی که قبلاً از یک URL بارگذاری شده بود)

// ---------- بارگذاری فایل .md از سیستم (فایل‌های لوکال) ----------
// جایی که File System Access API هست (مرورگرهای کرومیومی) از اون استفاده می‌کنیم
// تا هندلِ فایل رو نگه داریم و با رفرشِ تب، آخرین نسخه‌ی همون فایل از روی دیسک
// دوباره خونده بشه؛ جاهایی که این API نیست، همون input کلاسیک قبلی کار می‌کنه
// (با این تفاوت که رفرش، فایل رو دوباره لود نمی‌کنه، چون هندلی نگه‌داشته نمی‌شه)
const supportsFsAccess = "showOpenFilePicker" in window && "showDirectoryPicker" in window;

loadFileBtn.addEventListener("click", () => {
  if (supportsFsAccess) pickLocalFile();
  else mdFileInput.click();
});

async function pickLocalFile() {
  let handles;
  try {
    handles = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } }]
    });
  } catch {
    return; // کاربر لغو کرد
  }
  await loadLocalFileHandle(handles[0]);
}

// existingId رو فقط وقتی می‌دیم که هندل از IndexedDB (رفرش تب) اومده باشه؛
// وگرنه (انتخاب تازه‌ی کاربر) یک id جدید می‌سازه و هندل رو ذخیره می‌کنه
async function loadLocalFileHandle(handle, existingId = null) {
  const ok = await ensureReadPermission(handle);
  if (!ok) {
    showToast("اجازه‌ی خواندن فایل داده نشد ❌");
    return;
  }
  try {
    const file = await handle.getFile();
    const text = await file.text();
    DocumentResources.set({ fileHandle: handle, name: file.name });
    content.textContent = text;
    setPreviewMode(true);
    setCurrentFileName(file.name);
    currentFolderHandleId = null;
    activeFolderFileIdx = -1;
    renderFileHeader();
    const id = existingId || genHandleId();
    if (!existingId) await saveHandle(id, handle);
    setAddressParams({ kind: "file", handle: id, name: file.name });
    showToast(`«${file.name}» بارگذاری شد ✅`);
  } catch (err) {
    showToast(`خواندن فایل ناموفق بود ❌ (${err.message || "خطای ناشناخته"})`);
  }
}

mdFileInput.addEventListener("change", async () => {
  const file = mdFileInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    DocumentResources.set({ name: file.name });
    setAddressParams({});
    currentFolderHandleId = null;
    content.textContent = text;
    setPreviewMode(true);
    setCurrentFileName(file.name);
    activeFolderFileIdx = -1;
    renderFileHeader();
    showToast("فایل با موفقیت بارگذاری شد ✅");
    await ReaderTools.save();
  } catch (err) {
    showToast(`خواندن فایل ناموفق بود ❌ (${err.message || "خطای ناشناخته"})`);
  } finally {
    mdFileInput.value = "";
  }
});

// ============================================
// انتخاب یک پوشه از سیستم و نمایش فهرست افقی فایل‌های .md آن در هدر
// ============================================
let folderFiles = []; // { label, text } یا { label, handle } (وقتی از File System Access میاد)
let activeFolderFileIdx = -1;
let currentFolderHandleId = null; // شناسه‌ی هندلِ پوشه‌ی جاری در IndexedDB (اگه از این مسیر بارگذاری شده باشه)
let currentFolderRoot = null;
let currentFolderKind = "dir";

loadFolderBtn.addEventListener("click", () => {
  if (supportsFsAccess) pickLocalFolder();
  else mdFolderInput.click();
});

async function pickLocalFolder() {
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker();
  } catch {
    return; // کاربر لغو کرد
  }
  const id = genHandleId();
  await saveHandle(id, dirHandle);
  await loadLocalFolderHandle(dirHandle, id);
}

// بازگشتی همه‌ی فایل‌های .md زیرِ یک پوشه رو با هندلشون پیدا می‌کنه
async function collectMdEntries(dirHandle, prefix = "") {
  const out = [];
  for await (const [name, handle] of dirHandle.entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      if (/\.(md|markdown)$/i.test(name)) out.push({ label: rel, handle });
    } else if (handle.kind === "directory") {
      out.push(...(await collectMdEntries(handle, rel)));
    }
  }
  return out;
}

async function loadLocalFolderHandle(dirHandle, handleId, { activateLabel = null, target = {} } = {}) {
  const ok = await ensureReadPermission(dirHandle);
  if (!ok) {
    showToast("اجازه‌ی خواندن پوشه داده نشد ❌");
    return;
  }

  const originalLabel = loadFolderBtn.textContent;
  loadFolderBtn.disabled = true;
  loadFolderBtn.textContent = "⏳ در حال خواندن فایل‌ها...";

  try {
    const entries = await collectMdEntries(dirHandle);
    entries.sort((a, b) => a.label.localeCompare(b.label, "fa"));
    folderFiles = entries;
    currentFolderHandleId = handleId;
    currentFolderRoot = dirHandle;
    currentFolderKind = "dir";

    // A link may target any file, even when it is not in the Markdown index.
    if (activateLabel) {
      const idxToLoad = folderFiles.findIndex((f) => f.label === activateLabel);
      renderFileHeader();
      await loadFolderDocument(activateLabel, target, idxToLoad);
      return;
    }

    if (!folderFiles.length) {
      showToast("هیچ فایل .md ای در این پوشه پیدا نشد ❌");
      activeFolderFileIdx = -1;
      renderFileHeader();
      return;
    }

    activeFolderFileIdx = -1;
    renderFileHeader();
    setAddressParams({ kind: "dir", handle: handleId });

    showToast(`${folderFiles.length} فایل .md پیدا شد ✅`);
  } catch (err) {
    showToast(`خواندن فایل‌ها ناموفق بود ❌ (${err.message || "خطای ناشناخته"})`);
  } finally {
    loadFolderBtn.disabled = false;
    loadFolderBtn.textContent = originalLabel;
  }
}

mdFolderInput.addEventListener("change", async () => {
  const all = Array.from(mdFolderInput.files || []);
  const mdFiles = all.filter((f) => /\.(md|markdown)$/i.test(f.name));
  mdFolderInput.value = "";

  if (!mdFiles.length) {
    showToast("هیچ فایل .md ای در این پوشه پیدا نشد ❌");
    folderFiles = [];
    activeFolderFileIdx = -1;
    currentFolderHandleId = null;
    renderFileHeader();
    return;
  }

  mdFiles.sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, "fa")
  );

  const originalLabel = loadFolderBtn.textContent;
  loadFolderBtn.disabled = true;
  loadFolderBtn.textContent = "⏳ در حال خواندن فایل‌ها...";

  try {
    const entries = all.map((file) => {
      const rel = file.webkitRelativePath || file.name;
      const slashIdx = rel.indexOf("/");
      return { path: slashIdx !== -1 ? rel.slice(slashIdx + 1) : rel, file };
    });
    const id = genHandleId();
    await saveHandle(id, entries);
    await loadFolderBundle(entries, id);
    showToast(`${folderFiles.length} فایل .md پیدا شد ✅`);
  } catch (err) {
    showToast(`خواندن فایل‌ها ناموفق بود ❌ (${err.message || "خطای ناشناخته"})`);
  } finally {
    loadFolderBtn.disabled = false;
    loadFolderBtn.textContent = originalLabel;
  }
});

function renderFileHeader() {
  fileChipList.innerHTML = "";
  if (!folderFiles.length) {
    fileHeader.classList.remove("visible");
    return;
  }
  folderFiles.forEach((entry, idx) => {
    const chip = document.createElement("div");
    chip.className = "file-chip" + (idx === activeFolderFileIdx ? " active" : "");
    chip.title = entry.label;

    const name = document.createElement("span");
    name.className = "chip-name";
    name.textContent = entry.label;
    chip.appendChild(name);

    const newTabBtn = document.createElement("button");
    newTabBtn.type = "button";
    newTabBtn.className = "chip-newtab";
    newTabBtn.title = "باز کردن در تب جدید";
    newTabBtn.setAttribute("aria-label", `باز کردن «${entry.label}» در تب جدید`);
    newTabBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
      '<polyline points="15 3 21 3 21 9"/>' +
      '<line x1="10" y1="14" x2="21" y2="3"/>' +
      "</svg>";
    newTabBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openFolderFileInNewTab(idx);
    });
    chip.appendChild(newTabBtn);

    chip.addEventListener("click", (e) => {
      // Ctrl/Cmd+کلیک یا کلیک وسط، همون میانبر «باز کردن در تب جدید»
      if (e.ctrlKey || e.metaKey) {
        openFolderFileInNewTab(idx);
      } else {
        loadFolderFileInline(idx);
      }
    });
    chip.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        openFolderFileInNewTab(idx);
      }
    });

    fileChipList.appendChild(chip);
  });
  fileHeader.classList.add("visible");
}

// entry.handle یعنی از File System Access میاد؛ هر بار از روی دیسک تازه خونده می‌شه
// (نه از یک متنِ ذخیره‌شده)، پس اگه فایل بیرون از این تب ویرایش شده باشه، آخرین نسخه میاد
async function getEntryText(entry) {
  if (entry.handle) {
    const file = await entry.handle.getFile();
    return file.text();
  }
  return entry.text;
}

async function loadFolderBundle(entries, id, { entry = null, target = {} } = {}) {
  currentFolderRoot = entries;
  currentFolderHandleId = id;
  currentFolderKind = "bundle";
  folderFiles = entries.filter((item) => SourcePaths.isMarkdown(item.path)).map((item) => ({ label: item.path }));
  folderFiles.sort((a, b) => a.label.localeCompare(b.label, "fa"));
  activeFolderFileIdx = -1;
  renderFileHeader();
  if (entry) await loadFolderDocument(entry, target, folderFiles.findIndex((item) => item.label === entry));
  else setAddressParams({ kind: "bundle", handle: id });
}

async function loadFolderDocument(entry, target = {}, idx = -1) {
  const normalized = SourcePaths.folderPath("/" + entry, "", false);
  const source = { root: currentFolderRoot, rootId: currentFolderHandleId, rootKind: currentFolderKind, entry: normalized, name: normalized };
  const ref = { ...target, kind: "folder", rootId: source.rootId, rootKind: source.rootKind, entry: normalized };
  try {
    const file = await DocumentResources.fileFor(ref, source);
    const text = SourcePaths.isImage(normalized) ? "" : await file.text();
    DocumentResources.set(source, target);
    content.textContent = text;
    setCurrentFileName(normalized);
    activeFolderFileIdx = idx;
    renderFileHeader();
    setAddressParams(Object.fromEntries(new URLSearchParams(SourcePaths.viewerParams(ref))));
    setPreviewMode(true);
  } catch (err) {
    DocumentResources.warn(`خواندن فایل ناموفق بود: ${err.message}`);
  }
}

async function loadFolderFileInline(idx) {
  const entry = folderFiles[idx];
  if (!entry) return;
  if (currentFolderHandleId && currentFolderRoot) {
    await loadFolderDocument(entry.label, {}, idx);
    return;
  }
  let text;
  try {
    text = await getEntryText(entry);
  } catch (err) {
    showToast(`خواندن فایل ناموفق بود ❌ (${err.message || "خطای ناشناخته"})`);
    return;
  }
  content.textContent = text;
  DocumentResources.set({ name: entry.label });
  setPreviewMode(true);
  setCurrentFileName(entry.label);
  activeFolderFileIdx = idx;
  renderFileHeader();
  if (currentFolderHandleId) {
    setAddressParams({ kind: "dir", handle: currentFolderHandleId, entry: entry.label });
  }
  showToast(`«${entry.label}» بارگذاری شد ✅`);
}

function openFolderFileInNewTab(idx) {
  const entry = folderFiles[idx];
  if (!entry) return;
  if (currentFolderHandleId && currentFolderRoot) {
    const url =
      chrome.runtime.getURL("viewer.html") +
      `?kind=${currentFolderKind}&handle=${encodeURIComponent(currentFolderHandleId)}&entry=${encodeURIComponent(entry.label)}`;
    AdjacentTabs.open(url);
    return;
  }
  ViewerDrafts.create({ text: entry.text, preview: true, name: entry.label })
    .then((url) => AdjacentTabs.open(url))
    .catch((error) => showToast(`باز کردن متن ناموفق بود: ${error.message}`));
}

// ============================================
// تولبار شناور روی متن انتخاب‌شده: چپ‌چین یا کد
// ============================================
function hideSelToolbar() {
  selToolbar.classList.remove("show");
}

// ناحیه‌ی فعالِ فعلی: در حالت ویرایش متن خام، در حالت پیش‌نمایش خروجی رندرشده
function activeSurface() {
  return previewMode ? preview : content;
}

function updateSelToolbar() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.toString().trim()) {
    hideSelToolbar();
    return;
  }
  const range = sel.getRangeAt(0);
  if (!activeSurface().contains(range.commonAncestorContainer)) {
    hideSelToolbar();
    return;
  }
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hideSelToolbar();
    return;
  }
  selToolbar.classList.add("show");
  const toolbarRect = selToolbar.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - toolbarRect.width / 2),
    window.innerWidth - toolbarRect.width - 8
  );
  const top = Math.max(8, rect.top - toolbarRect.height - 8);
  selToolbar.style.left = left + "px";
  selToolbar.style.top = top + "px";
}

document.addEventListener("selectionchange", () => {
  requestAnimationFrame(updateSelToolbar);
});
window.addEventListener("scroll", hideSelToolbar, true);
window.addEventListener("resize", hideSelToolbar);

// جلوگیری از افتادن فوکوس/کولاپس‌شدن انتخاب موقع کلیک روی خود تولبار
selToolbar.addEventListener("mousedown", (e) => e.preventDefault());

function isInsideRenderedCode(range) {
  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  return !!(node.closest && node.closest("code, pre.code-block"));
}

const BLOCK_TAGS = /^(P|DIV|PRE|LI|UL|OL|H[1-6]|BLOCKQUOTE|TABLE|TR|HR)$/;

// Selection.toString() بین مرورگرها یکسان نیست (بعضی‌ها برای <br> و مرزِ بلاک‌ها
// خط‌جدید می‌گذارند و بعضی‌ها نه). برای اینکه تطبیق با متن خام قابل‌اتکا باشد،
// متن انتخاب‌شده را خودمان با مرزهای مشخص بیرون می‌کشیم.
function nodeToText(node) {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.nodeValue;
    } else if (child.nodeName === "BR") {
      out += "\n";
    } else {
      const isBlock = BLOCK_TAGS.test(child.nodeName);
      if (isBlock && out && !out.endsWith("\n")) out += "\n";
      out += nodeToText(child);
      if (isBlock && !out.endsWith("\n")) out += "\n";
    }
  });
  return out;
}

function rangeToText(range) {
  return nodeToText(range.cloneContents());
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// متنِ رندرشده و متنِ خام دقیقاً یکی نیستند: مرورگرها فاصله/خط‌جدید را در
// Selection.toString() جور دیگری سریال می‌کنند و متن خام هم نویسه‌های مارک‌داون
// (بک‌تیک، *، _) دارد که در خروجی دیده نمی‌شوند. پس به‌جای تطبیق عیناً برابر،
// روی «کلمه‌ها» تطبیق می‌دهیم و بین آن‌ها این نویسه‌ها را مجاز می‌شماریم.
function buildLooseMatcher(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return new RegExp(words.map(escapeRegExp).join("[\\s`*_~]+"), "g");
}

function normalizeForCounting(text) {
  return text.replace(/\s+/g, " ").trim();
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  let at;
  while ((at = haystack.indexOf(needle, from)) !== -1) {
    count++;
    from = at + needle.length;
  }
  return count;
}

// n اُمین تکرار (۰-پایه) از متن انتخاب‌شده را در متن خام پیدا می‌کند.
// اگر آن تکرار نبود، آخرین تطبیق موجود را برمی‌گرداند تا کار کاربر نخوابد.
function findSourceRange(source, selected, ordinal) {
  const matcher = buildLooseMatcher(selected);
  if (!matcher) return null;
  const hits = [];
  let m;
  while ((m = matcher.exec(source)) !== null) {
    hits.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) matcher.lastIndex++;
  }
  if (!hits.length) return null;
  return hits[Math.min(ordinal, hits.length - 1)];
}

// انتخابِ کاربر (چه در حالت ویرایش، چه در پیش‌نمایشِ رندرشده) را به موقعیتِ دقیقش
// در متن خامِ #content نگاشت می‌کند. چون همان متن ممکن است چند بار در سند تکرار
// شده باشد، «چندمین تکرار» را از روی متنِ قبل از نقطه‌ی شروعِ انتخاب حساب می‌کنیم.
function locateSelectionInSource(surfaceRoot, range, selected) {
  const before = document.createRange();
  before.setStart(surfaceRoot, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const ordinal = countOccurrences(
    normalizeForCounting(rangeToText(before)),
    normalizeForCounting(selected)
  );
  return findSourceRange(content.innerText, selected, ordinal);
}

// transform به‌جای فقط متنِ انتخاب‌شده، کل متنِ خام و بازه‌ی انتخاب را هم می‌گیرد
// تا بتواند بر اساس نویسه‌ی قبل/بعد تصمیم بگیرد (مثلاً خط‌جدید فقط وقتی لازم است
// اضافه شود، نه همیشه — وگرنه با هر بار اعمال، فاصله‌های خالی تلنبار می‌شوند)
function applyTransformToSelection(transform) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  const surface = activeSurface();
  if (!surface.contains(range.commonAncestorContainer)) return false;

  const selected = rangeToText(range);
  if (!selected.trim()) return false;

  // انتخاب داخل کدِ رندرشده به متنِ بینِ فنس‌ها نگاشت می‌شود؛ درج نشانه آنجا
  // فقط نشانه را به‌صورت متن خام داخل کد نشان می‌دهد، پس جلویش را می‌گیریم
  if (previewMode && isInsideRenderedCode(range)) {
    showToast("این بخش همین حالا کد یا چپ‌چین است ✅");
    return false;
  }

  const hit = locateSelectionInSource(surface, range, selected);
  if (!hit) {
    showToast("این بخش در متن خام پیدا نشد ❌");
    return false;
  }

  const source = content.innerText;
  const replacement = transform(source.slice(hit.start, hit.end), source, hit.start, hit.end);
  content.textContent = source.slice(0, hit.start) + replacement + source.slice(hit.end);
  return true;
}

function wrapSelectionText(transform) {
  if (!applyTransformToSelection(transform)) return;
  hideSelToolbar();
  // بلافاصله نتیجه‌ی رندرشده را نشان بده تا تغییر ظاهر در همان لحظه دیده شود
  setPreviewMode(true);
  ReaderTools.save();
}

selLtrBtn.addEventListener("click", () => {
  wrapSelectionText((text) => `[ltr]${text}[/ltr]`);
});

selCodeBtn.addEventListener("click", () => {
  wrapSelectionText((text, source, start, end) => {
    if (!text.includes("\n")) return `\`${text}\``;
    // فنسِ سه‌بک‌تیکی باید روی خط خودش باشد، ولی فقط وقتی خط‌جدیدِ لازم از قبل
    // آنجا نیست باید اضافه شود — وگرنه با هر بار اعمال، یک خط خالیِ تازه روی
    // خط خالیِ قبلی انباشته می‌شود و کل صفحه هر بار بیشتر «پرش» می‌کند
    const needsLeadingNL = start > 0 && source[start - 1] !== "\n";
    const needsTrailingNL = end < source.length && source[end] !== "\n";
    return `${needsLeadingNL ? "\n" : ""}\`\`\`\n${text}\n\`\`\`${needsTrailingNL ? "\n" : ""}`;
  });
});

// صفحه با ?kind=file|dir&handle=<id> باز شده: یعنی این تب قبلاً یک فایل/پوشه‌ی
// لوکال رو با File System Access API بارگذاری کرده بود و الان (بارگذاری اولیه
// یا رفرش) باید همون هندل رو از IndexedDB برداره و آخرین نسخه رو از دیسک بخونه
const viewerReady = (async function initializeViewer() {
  const defaults = await new Promise((resolve) => chrome.storage.local.get(
    { selectedFont: "Vazirmatn", viewerText: "", viewerPreview: false, viewerFileName: "", pendingFolderFiles: [] }, resolve));
  fontSelect.value = defaults.selectedFont === "system" ? "Vazirmatn" : defaults.selectedFont;
  applyFont(fontSelect.value);
  const params = new URLSearchParams(location.search);
  if (params.has("draft")) {
    await ReaderTools.restore(params.get("draft"));
    return;
  }
  if (params.has("src")) {
    urlInput.value = params.get("src");
    await fetchAndLoadUrl(urlInput.value, { updateAddress: false });
    return;
  }
  const kind = params.get("kind");
  const handleId = params.get("handle");
  if (!kind || !handleId) {
    // Migrate the old one-shot handoff without discarding existing pasted text.
    content.textContent = defaults.viewerText;
    DocumentResources.set({ name: defaults.viewerFileName });
    setCurrentFileName(defaults.viewerFileName);
    await setPreviewMode(!!defaults.viewerText && !!defaults.viewerPreview);
    if (defaults.pendingFolderFiles.length) {
      folderFiles = defaults.pendingFolderFiles;
      renderFileHeader();
    }
    await ReaderTools.save();
    chrome.storage.local.remove(["viewerText", "viewerPreview", "viewerFileName", "pendingFolderFiles"]);
    return;
  }

  let handle;
  try {
    handle = await loadHandle(handleId);
  } catch {
    handle = null;
  }
  if (!handle) {
    showToast("این فایل/پوشه قبلاً از سیستم انتخاب شده و دیگه در دسترس نیست؛ دوباره انتخابش کن ❌");
    return;
  }

  if (kind === "file") {
    await loadLocalFileHandle(handle, handleId);
  } else if (kind === "dir") {
    const entry = params.get("entry");
    await loadLocalFolderHandle(handle, handleId, { activateLabel: entry || null, target: { line: params.get("line"), endLine: params.get("endLine"), column: params.get("column"), anchor: params.get("anchor") } });
  } else if (kind === "bundle") {
    await loadFolderBundle(handle, handleId, { entry: params.get("entry"), target: { line: params.get("line"), endLine: params.get("endLine"), column: params.get("column"), anchor: params.get("anchor") } });
  }
})().catch((error) => {
  document.getElementById("saveStatus").textContent = "بارگذاری یا ذخیره ناموفق بود";
  showToast(error.message || "بارگذاری متن ناموفق بود.");
});
