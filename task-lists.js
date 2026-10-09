const TaskLists = {
  prepare(raw) {
    // Match the same fences as the renderer; task-looking code stays literal.
    const fences = Array.from(raw.matchAll(/```[^\n`]*\n[\s\S]*?```/g), (match) => [match.index, match.index + match[0].length]);
    return raw.replace(/^( *(?:>\s*)*(?:[-+*]|\d+[.)]) +)\[([ xX])\](?=\s|$)/gm,
      (match, prefix, state, index) => {
        if (fences.some(([start, end]) => index >= start && index < end)) return match;
        const offset = index + prefix.length + 1;
        return prefix + `\x00TASK${offset}:${state.toLowerCase() === "x" ? 1 : 0}\x00`;
      });
  },
  toggle(raw, offset, checked) {
    if (!Number.isInteger(offset) || raw[offset - 1] !== "[" || raw[offset + 1] !== "]" || !/[ xX]/.test(raw[offset] || "")) {
      throw new Error("متن چک‌لیست تغییر کرده است؛ دوباره امتحان کن.");
    }
    return raw.slice(0, offset) + (checked ? "x" : " ") + raw.slice(offset + 1);
  }
};
