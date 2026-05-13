
import { getByaiRuntime } from "./runtime";

let prevEmitIncrementKey = '';
// 用于累积流式内容的缓冲区
const streamSnapshots: Record<string, string> = {};
export async function emitIncrementalText(params: {
  key: string;
  rawText: string;
  normalize?: (text: string) => string;
  emit: (text: string, fullText: string) => Promise<void>;
}) {
  if (!params.rawText) {
    return;
  }
  if (params.key !== prevEmitIncrementKey) {
    Object.keys(streamSnapshots).forEach((key) => {
      if (key !== params.key) {
        delete streamSnapshots[key];
      }
    });
  }
  prevEmitIncrementKey = params.key;
  const fullText = params.normalize ? params.normalize(params.rawText) : params.rawText;
  if (!fullText.trim()) {
    return;
  }
  const previousText = streamSnapshots[params.key] ?? "";
  let nextText = fullText;
  if (previousText && fullText.startsWith(previousText)) {
    nextText = fullText.slice(previousText.length);
  }
  streamSnapshots[params.key] = fullText;
  if (!nextText) {
    return;
  }
  await params.emit(nextText, fullText);
}

export function getJsonMarkdown(json: unknown) {
  let text = '';
  if (typeof json === 'string') {
    try {
      JSON.parse(json);
      text = json;
    } catch {
      return json;
    }
  } else if (typeof json === 'object') {
    text = JSON.stringify(json, null, 2);
  }
  if (!text) {
    return "";
  }
  return `\`\`\`\n${text}\n\`\`\``;
}

export function ellipsis(text: string, maxLength: number = 50) {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + "...";
}

export function normalizeReasoningPreviewText(replyText: string) {
  return replyText
    .replace(/^Reasoning:\s*/, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return "";
      }
      const unwrapped =
        trimmed.startsWith("_") && trimmed.endsWith("_") && trimmed.length >= 2
          ? trimmed.slice(1, -1)
          : trimmed;
      return unwrapped.trim();
    })
    .join("\n")
    .trim();
}

export function getAgentDetailById(id?: string) {
  if (!id) {
    return undefined;
  }
  const config = getByaiRuntime().config.loadConfig();
  if (Array.isArray(config?.agents?.list)) {
    return config.agents.list.find((o: { id: string; name: string }) => o.id === id);
  }
  return undefined;
}

export function getAgentNameById(id?: string) {
  const detail = getAgentDetailById(id);
  return detail?.name ?? "";
}
