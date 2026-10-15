const CJK = /[\u4e00-\u9fff]/g;

const DROP_LINE = [
  /^\s*[{[]/,
  /jsonrpc/i,
  /tool[_ ]call/i,
  /session\/(prompt|update|new)/i,
  /\bMCP\b/,
  /^\s*diff --git/,
  /^\s*I'll\b/i,
  /^\s*I will\b/i,
  /^\s*Let me\b/i,
  /^\s*Here's what\b/i,
  /^\s*I can help\b/i,
  /正在(读取|调用|执行|搜索|打开文件)/,
  /Read\s+\S+\.(md|rs|ts|json)/i,
  /vaultPath|notes\.md|glossary\.md/i,
];

export function tidyQuote(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function cjkCount(text: string) {
  return text.match(CJK)?.length ?? 0;
}

function keepLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return !DROP_LINE.some((re) => re.test(trimmed));
}

export function looksLikeGarbage(text: string) {
  const value = text.trim();
  if (!value) return true;
  const cjk = cjkCount(value);
  if (cjk >= 8) return false;
  if (/译[：:]/.test(value) && cjk >= 2) return false;
  if (/jsonrpc|tool_call|I'll (read|open|check|help)|function\s*\(/i.test(value)) return true;
  if (cjk === 0 && value.length > 40) return true;
  if (cjk / Math.max(value.length, 1) < 0.06 && value.length > 80) return true;
  return false;
}

export function sanitizeAnswer(raw: string) {
  const stripped = raw
    .replace(/```[\s\S]*?```/g, (block) => {
      if (/jsonrpc|tool[_ ]call|session\/(prompt|update|new)/i.test(block)) return "";
      if (/^```json\b/i.test(block.trim()) && /^\s*\{/.test(block.replace(/^```json\s*/i, ""))) return "";
      return block;
    })
    .split("\n")
    .filter(keepLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const labeled = stripped.match(/(?:译|译文|翻译)[：:]\s*([^\n]+)/);
  const note = stripped.match(/(?:注|说明)[：:]\s*([^\n]+)/);
  if (labeled) {
    return note ? `译：${labeled[1].trim()}\n注：${note[1].trim()}` : `译：${labeled[1].trim()}`;
  }

  return stripped;
}

export function readerAnswer(raw: string, intent: "translate" | "explain" | "ask") {
  const text = sanitizeAnswer(raw);
  if (!looksLikeGarbage(text)) {
    return { ok: true, text };
  }
  const fallback =
    intent === "translate"
      ? "没有得到可用译文。模型把这次当成了编程任务。请确认已连接智能体后再点一次翻译。"
      : intent === "explain"
        ? "没有得到可用解释。请确认已连接智能体后再试一次。"
        : "没有得到可用回答。请确认已连接智能体后再问一次。";
  return { ok: false, text: fallback };
}
