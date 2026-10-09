const StandaloneExport = (() => {
  const fontFiles = {
    Vazirmatn: ["Vazirmatn-Regular.woff2", "Vazirmatn-Bold.woff2"],
    Shabnam: ["Shabnam.woff2", "Shabnam-Bold.woff2"],
    Sahel: ["Sahel.woff2", "Sahel-Bold.woff2"],
    Samim: ["Samim.woff2", "Samim-Bold.woff2"]
  };
  function dataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  async function build() {
    await setPreviewMode(true);
    const clone = preview.cloneNode(true);
    const context = DocumentResources.snapshot().source;
    clone.querySelectorAll(".copy-code-btn, .image-placeholder button").forEach((element) => element.remove());
    clone.querySelectorAll(".code-panel").forEach((panel) => panel.replaceWith(...panel.childNodes));
    for (const checkbox of clone.querySelectorAll(".task-checkbox")) {
      checkbox.toggleAttribute("checked", checkbox.checked);
      checkbox.disabled = true;
      checkbox.removeAttribute("data-task-offset");
    }
    // Inline images instead of exporting blob URLs tied to the extension tab.
    await Promise.all(Array.from(clone.querySelectorAll("img[data-source]")).map(async (image) => {
      const ref = SourcePaths.resolve(image.dataset.source, context);
      if (!ref || !["url", "folder"].includes(ref.kind)) throw new Error("منبع تصویر در دسترس نیست.");
      image.src = await dataUrl(await DocumentResources.fileFor(ref, context));
      image.removeAttribute("data-source");
      image.removeAttribute("loading");
    }));
    for (const link of clone.querySelectorAll("a[data-reference]")) {
      const ref = SourcePaths.resolve(link.dataset.reference, context);
      if (ref?.kind === "url" || ref?.kind === "external") {
        link.href = ref.url + (ref.fragment ? "#" + encodeURIComponent(ref.fragment) : "");
      } else if (ref?.kind === "anchor") {
        link.href = "#" + encodeURIComponent(ref.fragment || (ref.line ? `L${ref.line}` : ""));
        link.removeAttribute("target");
      } else {
        // Selected folder handles have no portable absolute path.
        link.removeAttribute("href");
        link.removeAttribute("target");
        link.title = "مسیر فایل: " + link.dataset.reference;
      }
      link.removeAttribute("data-reference");
    }
    const font = fontFiles[fontSelect.value] ? fontSelect.value : "Vazirmatn";
    const fonts = await Promise.all(fontFiles[font].map(async (file, index) => {
      const response = await fetch(chrome.runtime.getURL("fonts/" + file));
      if (!response.ok) throw new Error("بارگذاری فونت برای خروجی ناموفق بود.");
      const url = await dataUrl(await response.blob());
      return `@font-face{font-family:'${font}';src:url('${url}') format('woff2');font-weight:${index ? 700 : 400};}`;
    }));
    const styles = document.querySelector("style").textContent.replace(/@font-face\s*\{[^}]*\}/g, "");
    const size = Math.max(13, Math.min(34, Number(sizeRange.value) || 18));
    clone.style.fontFamily = `'${font}', Tahoma, sans-serif`;
    clone.style.fontSize = size + "px";
    const title = currentFileNameEl.textContent || clone.querySelector("h1, h2, h3")?.textContent || "متن فارسی";
    const toc = document.createElement("nav");
    toc.className = "export-outline";
    toc.setAttribute("aria-label", "فهرست تیترها");
    for (const heading of clone.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      const link = document.createElement("a");
      link.textContent = heading.textContent;
      link.href = "#" + encodeURIComponent(heading.id);
      toc.appendChild(link);
    }
    return '<!DOCTYPE html>\n<html lang="fa" dir="rtl" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      `<title>${escapeHtml(title)}</title><style>${fonts.join("\n")}\n${styles}\n` +
      `.export-outline{margin-bottom:24px;padding:16px;background:var(--code-bg);border-radius:8px}.export-outline a{display:block;color:var(--link-color)}#preview h1,#preview h2,#preview h3,#preview h4,#preview h5,#preview h6{scroll-margin-top:20px}</style></head>` +
      `<body style="font-family:'${font}',Tahoma,sans-serif"><main class="page">${toc.children.length ? toc.outerHTML : ""}${clone.outerHTML}</main></body></html>`;
  }
  document.getElementById("exportHtmlBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const html = await build();
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      const name = (currentFileNameEl.textContent || "متن فارسی").split(/[\\/]/).at(-1).replace(/\.[^.]+$/, "");
      link.download = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") + ".html";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast("فایل HTML آماده شد ✅");
    } catch (error) { showToast(`خروجی ساخته نشد: ${error.message}`); }
    finally { button.disabled = false; }
  });
  return { build };
})();
