import { describe, expect, it } from "vitest";
import { ThinkingStreamParser } from "../src/thinking-stream-parser.js";

describe("ThinkingStreamParser", () => {
  it("splits inline thinking from the visible answer without returning tags", () => {
    const parser = new ThinkingStreamParser();

    expect(parser.push('<think>The user said "hello"</think>\n\n你好！')).toEqual([
      { kind: "reasoning", text: 'The user said "hello"' },
      { kind: "answer", text: "\n\n你好！" },
    ]);
    expect(parser.finish()).toEqual([]);
  });

  it("recognizes tags split across arbitrary delta boundaries", () => {
    const parser = new ThinkingStreamParser();

    expect(parser.push("<thi")).toEqual([]);
    expect(parser.push("nk>分析中</thi")).toEqual([
      { kind: "reasoning", text: "分析中" },
    ]);
    expect(parser.push("nk>正文")).toEqual([{ kind: "answer", text: "正文" }]);
    expect(parser.finish()).toEqual([]);
  });

  it("preserves ordinary incomplete tag-like text when the stream ends", () => {
    const parser = new ThinkingStreamParser();

    expect(parser.push("正文 <thi")).toEqual([{ kind: "answer", text: "正文 " }]);
    expect(parser.finish()).toEqual([{ kind: "answer", text: "<thi" }]);
  });

  it("flushes an unclosed thinking block as reasoning without exposing its tag", () => {
    const parser = new ThinkingStreamParser();

    expect(parser.push("<think>仍在思考")).toEqual([
      { kind: "reasoning", text: "仍在思考" },
    ]);
    expect(parser.finish()).toEqual([]);
  });
});
