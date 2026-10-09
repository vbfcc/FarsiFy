// Shared by the popup and viewer. Never resolve document links against the extension URL.
const SourcePaths = (() => {
  function inputUrl(value) {
    const raw = value.trim();
    if (/^[a-z]:[\\/]/i.test(raw)) {
      const path = raw.replace(/\\/g, "/");
      return new URL("file:///" + path.split("/").map((part, i) => i === 0 ? part : encodeURIComponent(part)).join("/"));
    }
    if (/^\\\\/.test(raw)) {
      const [host, ...parts] = raw.slice(2).split(/\\/);
      return new URL(`file://${host}/${parts.map(encodeURIComponent).join("/")}`);
    }
    const url = new URL(raw);
    if (!["http:", "https:", "file:"].includes(url.protocol)) throw new Error("آدرس باید http، https یا مسیر فایل باشد.");
    return url;
  }

  function parseReference(value) {
    let path = value.trim();
    let fragment = "";
    let line = null;
    let endLine = null;
    let column = null;
    const hash = path.indexOf("#");
    if (hash !== -1) {
      fragment = path.slice(hash + 1);
      path = path.slice(0, hash);
      const match = fragment.match(/^(?:L|line=)?(\d+)(?:(?:-L?)(\d+))?(?:[:,](\d+))?$/i);
      if (match) {
        line = Number(match[1]);
        endLine = Number(match[2] || match[1]);
        column = match[3] ? Number(match[3]) : null;
        fragment = "";
      }
    }
    // A URL's port is not a source line. Only accept suffixes after a file extension.
    const suffix = path.match(/^(.*\.[a-z\d]+):(\d+)(?::(\d+))?$/i);
    if (suffix) {
      path = suffix[1];
      line = endLine = Number(suffix[2]);
      column = suffix[3] ? Number(suffix[3]) : null;
    }
    return { path, fragment, line: line > 0 ? line : null, endLine, column };
  }

  function folderPath(reference, entry = "", encoded = true) {
    let path;
    try {
      path = reference.replace(/\\/g, "/");
      if (encoded) path = decodeURIComponent(path.split("?")[0]);
    }
    catch { throw new Error("مسیر فایل نامعتبر است."); }
    const parts = path.startsWith("/") ? [] : entry.split("/").slice(0, -1);
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) throw new Error("فایل بیرون از پوشهٔ انتخاب‌شده است؛ پوشهٔ ریشهٔ پروژه را انتخاب کن.");
        parts.pop();
      } else {
        if (/[\x00-\x1f]/.test(part)) throw new Error("مسیر فایل نامعتبر است.");
        parts.push(part);
      }
    }
    return parts.join("/");
  }

  function resolve(value, source = {}) {
    const ref = parseReference(value);
    if (!ref.path) return { ...ref, kind: "anchor" };
    if (/^(?:javascript|data|vbscript|blob):/i.test(ref.path)) return null;
    if (/^mailto:/i.test(ref.path)) return { ...ref, kind: "external", url: ref.path };
    const absolute = /^[a-z]:[\\/]/i.test(ref.path) || /^\\\\/.test(ref.path) || /^[a-z][a-z\d+.-]*:/i.test(ref.path);
    if (absolute || source.url) {
      try {
        const url = absolute ? inputUrl(ref.path) : new URL(ref.path.replace(/\\/g, "/"), source.url);
        if (!["http:", "https:", "file:"].includes(url.protocol)) return null;
        return { ...ref, kind: "url", url: url.href };
      } catch { return null; }
    }
    if (source.rootId) return { ...ref, kind: "folder", entry: folderPath(ref.path, source.entry), rootId: source.rootId, rootKind: source.rootKind || "dir" };
    return { ...ref, kind: "unresolved" };
  }

  function isImage(path) { return /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)(?:[?#]|$)/i.test(path); }
  function isMarkdown(path) { return /\.(md|markdown)(?:[?#]|$)/i.test(path); }
  function viewerParams(ref) {
    const params = ref.kind === "folder"
      ? { kind: ref.rootKind, handle: ref.rootId, entry: ref.entry }
      : { src: ref.url };
    if (ref.line) {
      params.line = ref.line;
      params.endLine = Math.max(ref.line, ref.endLine || ref.line);
      if (ref.column) params.column = ref.column;
    }
    const anchor = ref.fragment || ref.anchor;
    if (anchor) params.anchor = anchor;
    return new URLSearchParams(params).toString();
  }
  return { inputUrl, parseReference, folderPath, resolve, isImage, isMarkdown, viewerParams };
})();
