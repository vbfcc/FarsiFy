// Document source context, image loading, and links shared across viewer tabs.
const DocumentResources = (() => {
  let source = {};
  let generation = 0;
  let objectUrls = [];
  let target = {};
  const notice = document.getElementById("resourceNotice");
  const noticeText = document.getElementById("resourceNoticeText");
  const attachBtn = document.getElementById("attachResourceFolderBtn");

  function set(next, nextTarget = {}) {
    resetRender();
    source = next;
    target = nextTarget;
    notice.hidden = true;
  }
  function snapshot() {
    const { root, ...persistedSource } = source;
    return { source: persistedSource, target: { ...target } };
  }
  function resetRender() {
    generation++;
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
  }
  function warn(message, canAttach = false) {
    noticeText.textContent = message;
    attachBtn.hidden = !canAttach || !(source.fileHandle || source.name) || !("showDirectoryPicker" in window);
    notice.hidden = false;
  }
  function link(value) {
    try {
      const ref = SourcePaths.resolve(value, source);
      if (!ref) return null;
      if (ref.kind === "anchor") return "#" + encodeURIComponent(ref.fragment || (ref.line ? `L${ref.line}` : ""));
      if (ref.kind === "external") return ref.url;
      if (ref.kind === "unresolved") return "#";
      const path = ref.entry || ref.url;
      // Ordinary websites remain ordinary links. Relative files and source references use the viewer.
      if (ref.kind === "url" && /^https?:/.test(ref.url) && !ref.line &&
          !SourcePaths.isMarkdown(path) && !SourcePaths.isImage(path) &&
          !/\.(txt|log|php|dart|js|jsx|ts|tsx|py|go|rs|java|json|yaml|yml|css|html|sql|sh|ps1|xml|csv)(?:[?#]|$)/i.test(path)) {
        return ref.url + (ref.fragment ? "#" + ref.fragment : "");
      }
      return chrome.runtime.getURL("viewer.html") + "?" + SourcePaths.viewerParams(ref);
    } catch { return "#"; }
  }

  async function fileFor(ref, context = source) {
    if (ref.kind === "url") {
      if (ref.url.startsWith("file:") && !(await chrome.extension.isAllowedFileSchemeAccess())) {
        throw new Error('در جزئیات افزونه، گزینهٔ «Allow access to file URLs» را فعال کن و دوباره بارگذاری کن.');
      }
      const res = await fetch(ref.url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    }
    if (ref.kind !== "folder") throw new Error("برای نمایش تصاویر و باز کردن لینک‌های نسبی، پوشهٔ سند یا ریشهٔ پروژه را انتخاب کن.");
    const root = context.root || await loadHandle(ref.rootId);
    if (!root) throw new Error("پوشهٔ منبع در دسترس نیست؛ دوباره انتخابش کن.");
    if (ref.rootKind === "bundle") {
      const entry = root.find((item) => item.path === ref.entry);
      if (!entry) throw new Error(`فایل پیدا نشد: ${ref.entry}`);
      return entry.file;
    }
    const parts = ref.entry.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return (await dir.getFileHandle(parts.at(-1))).getFile();
  }

  function blobUrl(blob) {
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    return url;
  }
  function showImageFailure(img, message, canAttach) {
    // Show the recovery action at the image, where the reader sees the failure.
    const placeholder = document.createElement("span");
    placeholder.className = "image-placeholder";
    const explanation = document.createElement("span");
    explanation.textContent = message;
    placeholder.appendChild(explanation);
    if (canAttach && (source.fileHandle || source.name) && "showDirectoryPicker" in window) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "📂 انتخاب پوشهٔ منبع تصاویر";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        attachFolder();
      });
      placeholder.appendChild(button);
    }
    const path = document.createElement("span");
    path.className = "image-source-path";
    path.dir = "ltr";
    path.textContent = img.dataset.source;
    placeholder.appendChild(path);
    img.replaceWith(placeholder);
  }
  async function hydrate(root) {
    const current = generation;
    const context = source;
    const cache = new Map();
    if (!context.url && !context.rootId && root.querySelector("[data-reference], img[data-source]")) {
      const relative = Array.from(root.querySelectorAll("[data-reference], img[data-source]")).some((el) => {
        try { return SourcePaths.resolve(el.dataset.reference || el.dataset.source, context)?.kind === "unresolved"; }
        catch { return false; }
      });
      if (relative) warn("فقط خودِ داک انتخاب شده است. برای نمایش تصاویر و باز کردن فایل‌های مرتبط، پوشهٔ داک یا ریشهٔ پروژه را انتخاب کن.", true);
    }
    await Promise.all(Array.from(root.querySelectorAll("img[data-source]")).map(async (img) => {
      const value = img.dataset.source;
      try {
        const ref = SourcePaths.resolve(value, context);
        if (!ref || ref.kind === "anchor" || ref.kind === "external") throw new Error("آدرس تصویر معتبر نیست.");
        if (ref.kind === "url" && /^https?:/.test(ref.url)) {
          img.src = ref.url;
        } else {
          const key = ref.entry || ref.url || value;
          if (!cache.has(key)) cache.set(key, fileFor(ref, context));
          const file = await cache.get(key);
          if (current !== generation) return;
          img.src = blobUrl(file);
        }
        img.onerror = () => {
          if (current !== generation) return;
          showImageFailure(img, "تصویر بارگذاری نشد؛ مسیر یا دسترسی فایل را بررسی کن.", false);
          warn(`تصویر بارگذاری نشد: ${value}`);
        };
      } catch (err) {
        if (current !== generation) return;
        const canAttach = !context.url && !context.rootId;
        showImageFailure(img, canAttach ? "برای خواندن این تصویر، دسترسی به پوشهٔ منبع لازم است." : err.message, canAttach);
        warn(err.message, canAttach);
      }
    }));
    if (current === generation) scrollToTarget();
  }

  function sourceHtml(text) {
    const lines = text.split(/\r\n|\r|\n/);
    const start = Number(target.line) || 0;
    const end = Math.max(start, Number(target.endLine) || start);
    return '<pre class="source-file" dir="ltr"><code>' + lines.map((line, index) => {
      const n = index + 1;
      return `<span class="source-line${n >= start && n <= end ? " selected-line" : ""}" id="L${n}"><a class="line-number" href="#L${n}" aria-label="Line ${n}">${n}</a><span>${escapeHtml(line) || " "}</span></span>`;
    }).join("") + "</code></pre>";
  }
  function render(text) {
    resetRender();
    const name = source.entry || source.url || source.name || "";
    if (SourcePaths.isImage(name)) {
      const ref = source.url || source.entry.split("/").at(-1);
      return `<img class="document-image" data-source="${escapeHtml(ref)}" alt="${escapeHtml(source.name || name)}">`;
    }
    if (target.line || (name && !SourcePaths.isMarkdown(name))) return sourceHtml(text);
    return renderMarkdown(text);
  }
  function scrollToTarget() {
    const id = target.line ? `L${target.line}` : target.anchor;
    if (!id) return;
    let decoded;
    try { decoded = decodeURIComponent(id); } catch { decoded = id; }
    const el = document.getElementById(decoded);
    if (el) el.scrollIntoView({ block: "center" });
    else if (target.line) warn(`خط ${target.line} در این فایل وجود ندارد.`);
  }

  async function attachFolder() {
    const context = source;
    try {
      const root = await window.showDirectoryPicker(context.fileHandle ? { startIn: context.fileHandle } : {});
      let parts = context.fileHandle ? await root.resolve(context.fileHandle) : null;
      if (!context.fileHandle && context.name) {
        const entries = await collectMdEntries(root);
        const matches = entries.filter((entry) => entry.label === context.name || entry.label.endsWith("/" + context.name));
        if (matches.length === 1) parts = matches[0].label.split("/");
      }
      if (!parts) throw new Error("پوشه‌ای را انتخاب کن که فایل فعلی داخل آن قرار دارد؛ برای لینک‌های بین پوشه‌ها، ریشهٔ پروژه را انتخاب کن.");
      if (context !== source) return;
      const rootId = genHandleId();
      await saveHandle(rootId, root);
      set({ root, rootId, entry: parts.join("/"), name: context.name }, target);
      if (ReaderTools.isDraft()) await ReaderTools.save();
      else setAddressParams(Object.fromEntries(new URLSearchParams(SourcePaths.viewerParams({ ...target, kind: "folder", rootId, rootKind: "dir", entry: parts.join("/") }))));
      setPreviewMode(true);
    } catch (err) {
      if (err.name !== "AbortError") warn(err.message, true);
    }
  }
  attachBtn.addEventListener("click", attachFolder);

  function handleLink(event) {
    const anchor = event.target.closest("a[data-reference]");
    if (!anchor || (event.type === "auxclick" && event.button !== 1)) return;
    try {
      const ref = SourcePaths.resolve(anchor.dataset.reference, source);
      if (!ref) { event.preventDefault(); return; }
      if (ref.kind === "unresolved") {
        event.preventDefault();
        warn("برای باز کردن لینک‌های نسبی، پوشهٔ سند یا ریشهٔ پروژه را انتخاب کن.", true);
      } else if (ref.kind === "anchor") {
        event.preventDefault();
        if (ref.line) {
          target = { line: ref.line, endLine: ref.endLine };
          setPreviewMode(true);
        } else {
          let id;
          try { id = decodeURIComponent(ref.fragment); } catch { id = ref.fragment; }
          document.getElementById(id)?.scrollIntoView({ block: "start" });
        }
      }
    } catch (err) { event.preventDefault(); warn(err.message); }
  }
  document.getElementById("preview").addEventListener("click", handleLink);
  document.getElementById("preview").addEventListener("auxclick", handleLink);
  window.addEventListener("pagehide", resetRender);
  return { set, snapshot, render, hydrate, link, fileFor, warn };
})();
