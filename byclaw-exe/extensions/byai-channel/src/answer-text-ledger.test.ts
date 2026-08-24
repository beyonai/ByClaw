import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDeliveredAnswerText,
  deliveredAnswerTextCovers,
  recordPushedAnswerText,
  recordStreamedAnswerSegment,
} from "./answer-text-ledger.js";

const SK = "agent:main:direct:11037877";
const RUN = "f30b215a-a4cc-41a3-8f6e-14963c904c44";
const OTHER_RUN = "a8327bd8-1111-2222-3333-444455556666";

function streamParent(sessionKey: string | undefined, runId: string | undefined, text: string) {
  recordStreamedAnswerSegment({ sessionKey, runId, segmentText: text, isChildSession: false });
}

function streamChild(sessionKey: string, runId: string, text: string) {
  recordStreamedAnswerSegment({ sessionKey, runId, segmentText: text, isChildSession: true });
}

describe("answer-text-ledger", () => {
  beforeEach(() => {
    clearDeliveredAnswerText(SK);
    clearDeliveredAnswerText("sk-a");
    clearDeliveredAnswerText("sk-b");
  });

  it("suppresses a final-reply echo already streamed on the answer channel", () => {
    // 答案流按 delta 累积，记账时传的是缓冲里的段落全文，sendText 送来整段最终文本。
    streamParent(SK, RUN, "两份天气报告");
    streamParent(SK, RUN, "两份天气报告都回来后，我会一并整合给你。");

    expect(deliveredAnswerTextCovers(SK, "两份天气报告都回来后，我会一并整合给你。")).toBe(true);
  });

  it("suppresses the last segment of a run that emitted several segments", () => {
    // 一个 run 内 assistant 文本被工具调用切成多段，流式缓冲逐段替换；core 只投最后一段。
    streamParent(SK, RUN, "我先查一下两地天气。");
    streamParent(SK, RUN, "查询完成，下面是整理后的报告：北京 38℃，广州 33℃。");

    expect(deliveredAnswerTextCovers(SK, "查询完成，下面是整理后的报告：北京 38℃，广州 33℃。")).toBe(
      true,
    );
    // 被替换掉的前一段不再是投递依据，重新送来应放行而不是当成重复吞掉。
    expect(deliveredAnswerTextCovers(SK, "我先查一下两地天气。")).toBe(false);
  });

  it("suppresses a core retry of text already streamed by a child run", () => {
    // 子会话流式文本落思考通道，但已推给前端。core 的 text-direct 直投的是 trim 后的同一份
    // 原文，等值即命中：抑制后内容留在思考区，不再进答案区，但不丢。
    streamChild(SK, OTHER_RUN, "广州今天多云，26-33℃。");

    expect(deliveredAnswerTextCovers(SK, "广州今天多云，26-33℃。")).toBe(true);
  });

  it("pushes a child report that never streamed", () => {
    // 账本里没有条目就说明这份内容没推过（如缺 emitter），core 的直投是它唯一的到达路径。
    streamChild(SK, OTHER_RUN, "两份天气报告都回来后，我会一并整合给你。");

    expect(deliveredAnswerTextCovers(SK, "广州今天多云，26-33℃。")).toBe(false);
  });

  it("keeps a parent reply contained in a long child report deliverable", () => {
    // 子会话组只做等值：长报告包含 parent 的最终答案时不能连它一起抑制，否则那句答案只以
    // 报告的一部分留在思考区，答案区空着。
    streamChild(
      SK,
      OTHER_RUN,
      "北京今天晴，28-38℃。广州今天多云，26-33℃。两地天气已整理完毕，供你参考。",
    );

    expect(deliveredAnswerTextCovers(SK, "两地天气已整理完毕")).toBe(false);
  });

  it("does not let a child report prefix-match a longer delivery", () => {
    // 前缀那一向也只留给父/推送组：子报告开头恰好是另一段更长文本的开头时不应抑制。
    streamChild(SK, OTHER_RUN, "北京今天晴，28-38℃。广州今天多云，26-33℃。");

    expect(
      deliveredAnswerTextCovers(SK, "北京今天晴，28-38℃。广州今天多云，26-33℃。另附穿衣建议。"),
    ).toBe(false);
  });

  it("pushes message-tool sends because they have no answer stream", () => {
    expect(deliveredAnswerTextCovers(SK, "你好，这是一条主动通知")).toBe(false);
  });

  it("never matches across two runs' groups", () => {
    // 分组独立判定：两组各自的尾首拼起来的子串谁都没发过，不能算重复。
    streamParent(SK, RUN, "广州天气");
    streamParent(SK, OTHER_RUN, "已整理完毕");

    expect(deliveredAnswerTextCovers(SK, "广州天气已整理完毕")).toBe(false);
    expect(deliveredAnswerTextCovers(SK, "广州天气")).toBe(true);
    expect(deliveredAnswerTextCovers(SK, "已整理完毕")).toBe(true);
  });

  it("suppresses text that appends to a long streamed segment", () => {
    // core 在 deliver 前可能给流式原文补尾（例如附注）；条目足够长时按前缀判定为同一份。
    const streamed = "北京今日天气：晴，38℃，体感 40℃，湿度 37%，南偏东南风 11km/h，紫外线偏强。";
    streamParent(SK, RUN, streamed);

    expect(deliveredAnswerTextCovers(SK, `${streamed}\n\n数据来源：中国天气网`)).toBe(true);
  });

  it("keeps a short streamed segment from swallowing a longer new answer", () => {
    // 短条目不启用前缀方向，否则刚开始流的几个字会吞掉后面任何以之开头的可见内容。
    streamParent(SK, RUN, "好的");

    expect(deliveredAnswerTextCovers(SK, "好的，我把两地天气整理成一份完整报告发给你。")).toBe(
      false,
    );
  });

  it("absorbs whitespace differences introduced by core payload normalization", () => {
    streamParent(SK, RUN, "第一行\n第二行");

    expect(deliveredAnswerTextCovers(SK, "  第一行\r\n\r\n第二行  ")).toBe(true);
  });

  it("records channel-pushed text so a core retry of it is suppressed", () => {
    recordPushedAnswerText(SK, "广州今天多云，26-33℃。");

    expect(deliveredAnswerTextCovers(SK, "广州今天多云，26-33℃。")).toBe(true);
  });

  it("keeps each pushed text in its own group", () => {
    recordPushedAnswerText(SK, "广州今天多云。");
    recordPushedAnswerText(SK, "北京今天晴。");

    expect(deliveredAnswerTextCovers(SK, "广州今天多云。北京今天晴。")).toBe(false);
    expect(deliveredAnswerTextCovers(SK, "北京今天晴。")).toBe(true);
  });

  it("keeps parent and child groups apart when they share a runId", () => {
    // 子会话组带前缀，同 runId 不会覆盖父组，两组各自按自己的强度判定。
    streamParent(SK, RUN, "父会话这一段的整段文本长到足以走包含判定。");
    streamChild(SK, RUN, "子任务原文");

    expect(deliveredAnswerTextCovers(SK, "父会话这一段的整段文本")).toBe(true);
    expect(deliveredAnswerTextCovers(SK, "子任务原文")).toBe(true);
    expect(deliveredAnswerTextCovers(SK, "子任务原文的一部分")).toBe(false);
  });

  it("keeps ledgers isolated per sessionKey and clears them on teardown", () => {
    streamParent("sk-a", RUN, "A 的答案");

    expect(deliveredAnswerTextCovers("sk-b", "A 的答案")).toBe(false);
    expect(deliveredAnswerTextCovers("sk-a", "A 的答案")).toBe(true);

    clearDeliveredAnswerText("sk-a");
    expect(deliveredAnswerTextCovers("sk-a", "A 的答案")).toBe(false);
  });

  it("treats blank text as covered and never records it", () => {
    expect(deliveredAnswerTextCovers(SK, "   \n  ")).toBe(true);
    streamParent(SK, RUN, "   ");
    expect(deliveredAnswerTextCovers(SK, "任何内容")).toBe(false);
  });

  it("ignores a missing sessionKey or runId instead of cross-contaminating the store", () => {
    streamParent(undefined, RUN, "无主文本");
    streamParent(SK, undefined, "无 run 文本");

    expect(deliveredAnswerTextCovers(undefined, "无主文本")).toBe(false);
    expect(deliveredAnswerTextCovers(SK, "无 run 文本")).toBe(false);
  });
});
