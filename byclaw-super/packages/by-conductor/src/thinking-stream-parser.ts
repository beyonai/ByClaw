export type ThinkingStreamSegment = {
  kind: "answer" | "reasoning";
  text: string;
};

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

/**
 * 流式拆分模型在普通文本通道中返回的 `<think>...</think>` 兼容格式。
 * 标签可能跨任意 delta 边界，因此会暂存可能构成标签的最短后缀。
 */
export class ThinkingStreamParser {
  #buffer = "";
  #insideThinking = false;

  push(chunk: string): ThinkingStreamSegment[] {
    if (!chunk) return [];
    this.#buffer += chunk;
    return this.#drain(false);
  }

  finish(): ThinkingStreamSegment[] {
    return this.#drain(true);
  }

  #drain(flush: boolean): ThinkingStreamSegment[] {
    const segments: ThinkingStreamSegment[] = [];

    while (this.#buffer) {
      const tag = this.#insideThinking ? CLOSE_TAG : OPEN_TAG;
      const tagIndex = this.#buffer.indexOf(tag);
      if (tagIndex >= 0) {
        this.#append(segments, this.#buffer.slice(0, tagIndex));
        this.#buffer = this.#buffer.slice(tagIndex + tag.length);
        this.#insideThinking = !this.#insideThinking;
        continue;
      }

      const retainedLength = flush ? 0 : longestTagPrefixSuffix(this.#buffer, tag);
      const emitLength = this.#buffer.length - retainedLength;
      if (emitLength > 0) {
        this.#append(segments, this.#buffer.slice(0, emitLength));
        this.#buffer = this.#buffer.slice(emitLength);
      }
      break;
    }

    return segments;
  }

  #append(segments: ThinkingStreamSegment[], text: string): void {
    if (!text) return;
    const kind = this.#insideThinking ? "reasoning" : "answer";
    const previous = segments.at(-1);
    if (previous?.kind === kind) {
      previous.text += text;
      return;
    }
    segments.push({ kind, text });
  }
}

function longestTagPrefixSuffix(text: string, tag: string): number {
  const maxLength = Math.min(text.length, tag.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (text.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}
