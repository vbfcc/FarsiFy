const ReaderTools = (() => {
  const outline = document.getElementById("outline");
  const outlineList = document.getElementById("outlineList");
  const outlineButton = document.getElementById("outlineBtn");
  const layout = document.getElementById("documentLayout");
  const status = document.getElementById("saveStatus");
  let draftId = new URLSearchParams(location.search).get("draft");
  let outlineVisible = true;
  let writes = Promise.resolve();
  let revision = 0;

  function addressChanged(params) {
    draftId = params.draft || null;
    status.textContent = "";
  }
  function save() {
    if (!draftId) {
      draftId = ViewerDrafts.newId();
      setAddressParams({ draft: draftId });
    }
    const id = draftId;
    const version = ++revision;
    const document = {
      text: content.innerText,
      name: currentFileNameEl.textContent,
      preview: previewMode,
      font: fontSelect.value,
      size: Number(sizeRange.value),
      outline: outlineVisible,
      ...DocumentResources.snapshot()
    };
    status.textContent = "در حال ذخیره…";
    const journal = ViewerDrafts.journal(id, document);
    // Serialize writes so a slow earlier save cannot replace a later edit.
    writes = writes.catch(() => {}).then(() => ViewerDrafts.save(id, document));
    writes.then(() => {
      ViewerDrafts.clearJournal(id, journal);
      if (id === draftId && version === revision) status.textContent = "ذخیره شد";
    }, () => {
      if (id === draftId && version === revision) status.textContent = "ذخیره نشد؛ دوباره تلاش کن";
    });
    return writes;
  }
  async function restore(id) {
    draftId = id;
    const recovery = ViewerDrafts.recovery(id);
    let stored;
    try { stored = await ViewerDrafts.load(id); }
    catch (error) { if (!recovery) throw error; }
    const saved = recovery ? { ...stored, ...recovery, source: { ...stored?.source, ...recovery.source } } : stored;
    if (!saved) {
      status.textContent = "متن ذخیره‌شده پیدا نشد";
      showToast("این متن در حافظهٔ مرورگر پیدا نشد.");
      return;
    }
    content.textContent = saved.text || "";
    DocumentResources.set(saved.source || { name: saved.name || "" }, saved.target || {});
    setCurrentFileName(saved.name || "");
    if (["Vazirmatn", "Shabnam", "Sahel", "Samim"].includes(saved.font)) {
      fontSelect.value = saved.font;
      applyFont(saved.font);
    }
    if (Number.isFinite(saved.size)) {
      sizeRange.value = Math.max(13, Math.min(34, saved.size));
      content.style.fontSize = sizeRange.value + "px";
      preview.style.fontSize = sizeRange.value + "px";
      sizeVal.textContent = sizeRange.value;
    }
    outlineVisible = saved.outline !== false;
    await setPreviewMode(!!saved.preview);
    status.textContent = "ذخیره شد";
    if (recovery) await save();
  }

  function updateOutline() {
    outlineList.replaceChildren();
    const headings = Array.from(preview.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    const base = Math.min(...headings.map((heading) => Number(heading.tagName[1])));
    for (const heading of headings) {
      const link = document.createElement("a");
      link.textContent = heading.textContent;
      link.href = "#" + encodeURIComponent(heading.id);
      link.dataset.headingId = heading.id;
      link.style.paddingInlineStart = (Number(heading.tagName[1]) - base) * 14 + 10 + "px";
      outlineList.appendChild(link);
    }
    outlineButton.disabled = !previewMode || !headings.length;
    const shown = previewMode && headings.length > 0 && outlineVisible;
    outline.hidden = !shown;
    layout.classList.toggle("has-outline", shown);
    outlineButton.setAttribute("aria-expanded", String(shown));
  }
  function decorate() {
    for (const block of preview.querySelectorAll("pre")) {
      if (block.parentElement.classList.contains("code-panel")) continue;
      const panel = document.createElement("div");
      panel.className = "code-panel";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy-code-btn";
      button.textContent = "کپی کد";
      button.setAttribute("aria-label", "کپی این بلوک کد");
      block.before(panel);
      panel.append(button, block);
    }
    updateOutline();
  }

  outlineButton.addEventListener("click", () => {
    outlineVisible = !outlineVisible;
    updateOutline();
    if (draftId) save();
  });
  outlineList.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-heading-id]");
    if (!link) return;
    event.preventDefault();
    document.getElementById(link.dataset.headingId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    outlineList.querySelectorAll("[aria-current]").forEach((item) => item.removeAttribute("aria-current"));
    link.setAttribute("aria-current", "location");
  });
  document.getElementById("preview").addEventListener("click", async (event) => {
    const button = event.target.closest(".copy-code-btn");
    if (!button) return;
    const code = button.parentElement.querySelector("pre code");
    const text = code.closest(".source-file")
      ? content.innerText
      : code.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "کپی شد ✓";
      setTimeout(() => { button.textContent = "کپی کد"; }, 1500);
    } catch { showToast("کپی نشد؛ دسترسی کلیپ‌بورد را بررسی کن."); }
  });
  document.getElementById("preview").addEventListener("change", (event) => {
    const checkbox = event.target.closest("input.task-checkbox");
    if (!checkbox) return;
    try {
      content.textContent = TaskLists.toggle(content.innerText, Number(checkbox.dataset.taskOffset), checkbox.checked);
      save();
      setPreviewMode(true);
      preview.querySelector(`[data-task-offset="${checkbox.dataset.taskOffset}"]`)?.focus({ preventScroll: true });
    } catch (error) { showToast(error.message); setPreviewMode(true); }
  });
  document.getElementById("content").addEventListener("input", () => { save(); });
  for (const [id, event] of [["fontSelect", "change"], ["sizeRange", "input"]]) {
    document.getElementById(id).addEventListener(event, () => { if (draftId) save(); });
  }
  window.addEventListener("pagehide", () => { if (draftId) save(); });
  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty("--header-height", entry.target.offsetHeight + "px");
  }).observe(document.querySelector(".header-wrap"));

  return { save, restore, decorate, updateOutline, addressChanged, isDraft: () => !!draftId, flush: () => writes };
})();
