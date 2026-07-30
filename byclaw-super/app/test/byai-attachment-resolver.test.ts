import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_INSPECTION_ERROR_CODES,
  AttachmentInspectionError,
  type RunAttachment,
} from "@byclaw/by-conductor";
import { ByAiAttachmentResolver } from "../business/byai-attachment-resolver.js";

const PRINCIPAL = { userCode: "u1001", userName: "测试用户" };

function attachmentOf(overrides: Partial<RunAttachment> = {}): RunAttachment {
  return {
    id: "12345",
    name: "notes.txt",
    mediaType: "text/plain",
    size: 12,
    provenance: "http",
    ...overrides,
  };
}

/** 构造一个 body 为给定字节块序列的下载响应。 */
function streamResponse(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/octet-stream", ...headers },
  });
}

function textResponse(text: string, headers: Record<string, string> = {}): Response {
  return streamResponse([new TextEncoder().encode(text)], headers);
}

describe("ByAiAttachmentResolver", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "resolver-test-"));
  });

  afterEach(async () => {
    // 每次 inspect 结束后不得残留 inspect-* 临时目录（T19 清理验收）。
    const leftovers = (await readdir(tempRoot)).filter((entry) =>
      entry.startsWith("inspect-"),
    );
    expect(leftovers).toEqual([]);
  });

  function resolverOf(fetchImpl: typeof fetch, limits: Record<string, number> = {}) {
    return new ByAiAttachmentResolver({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl,
      tempDir: tempRoot,
      ...limits,
    });
  }

  function inspectInput(overrides: Record<string, unknown> = {}) {
    return {
      attachment: attachmentOf(),
      principal: PRINCIPAL,
      credential: "run-scoped-token",
      mode: "text" as const,
      signal: new AbortController().signal,
      ...overrides,
    };
  }

  it("metadata 模式直接返回 Run 记录字段，不调用 BE", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const resolver = resolverOf(fetchImpl);
    const result = await resolver.inspect(inspectInput({ mode: "metadata" }));
    expect(result).toMatchObject({
      attachmentId: "12345",
      name: "notes.txt",
      mediaType: "text/plain",
      mode: "metadata",
      byteSize: 12,
      truncated: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("text 模式经 BE 按 fileId 下载并返回有界文本，携带 Beyond-Token", async () => {
    const fetchImpl = vi.fn(async () => textResponse("hello attachment"));
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch);
    const result = await resolver.inspect(inspectInput());

    expect(result.mode).toBe("text");
    expect(result.text).toBe("hello attachment");
    expect(result.truncated).toBe(false);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe(
      "http://127.0.0.1:8086/byaiService/commonFile/download?fileId=12345",
    );
    expect((init as RequestInit).headers).toMatchObject({
      "Beyond-Token": "run-scoped-token",
    });
  });

  it("text 模式超过 maxTextChars 时截断并标注", async () => {
    const fetchImpl = vi.fn(async () => textResponse("x".repeat(100)));
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch, {
      maxTextChars: 10,
    });
    const result = await resolver.inspect(inspectInput());
    expect(result.text).toBe("x".repeat(10));
    expect(result.truncated).toBe(true);
    expect(result.note).toContain("前 10 字符");
  });

  it("structure 模式返回 JSON 顶层结构摘要", async () => {
    const fetchImpl = vi.fn(async () =>
      textResponse(JSON.stringify({ a: 1, b: [1, 2], c: "x" })),
    );
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch);
    const result = await resolver.inspect(
      inspectInput({
        mode: "structure",
        attachment: attachmentOf({ name: "data.json", mediaType: "application/json" }),
      }),
    );
    expect(result.structure).toContain("顶层 3 个键");
    expect(result.structure).toContain("- b: array(2)");
  });

  it("structure 模式返回 CSV 行列概览", async () => {
    const fetchImpl = vi.fn(async () => textResponse("name,age\n甲,1\n乙,2\n"));
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch);
    const result = await resolver.inspect(
      inspectInput({
        mode: "structure",
        attachment: attachmentOf({ name: "users.csv", mediaType: "text/csv" }),
      }),
    );
    expect(result.structure).toContain("2 列");
    expect(result.structure).toContain("2 行数据");
    expect(result.structure).toContain("name | age");
  });

  it("materialize 下载原始二进制到会话目录并返回安全相对路径", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    const fetchImpl = vi.fn(async () => streamResponse([bytes]));
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch);
    const destinationDirectory = join(tempRoot, "session");

    const result = await resolver.materialize({
      attachment: attachmentOf({
        name: "../../report.pdf",
        mediaType: "application/pdf",
      }),
      principal: PRINCIPAL,
      credential: "run-scoped-token",
      destinationDirectory,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      attachmentId: "12345",
      name: "../../report.pdf",
      mediaType: "application/pdf",
      byteSize: bytes.byteLength,
      relativePath: "attachments/12345/report.pdf",
    });
    expect(
      new Uint8Array(await readFile(join(destinationDirectory, result.relativePath))),
    ).toEqual(bytes);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("非数字 attachment id 无法经 BE 解析，返回明确失败", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const resolver = resolverOf(fetchImpl);
    await expect(
      resolver.inspect(inspectInput({ attachment: attachmentOf({ id: "attachment-0" }) })),
    ).rejects.toMatchObject({
      name: "AttachmentInspectionError",
      code: ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["pack.zip", "application/zip", "压缩包"],
    ["photo.png", "image/png", "图像"],
    ["report.pdf", "application/pdf", "二进制文档"],
    ["data.bin", "application/octet-stream", "不支持"],
  ])("%s 返回结构化 TYPE_UNSUPPORTED", async (name, mediaType, keyword) => {
    const resolver = resolverOf(vi.fn() as unknown as typeof fetch);
    const error = await resolver
      .inspect(inspectInput({ attachment: attachmentOf({ name, mediaType }) }))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AttachmentInspectionError);
    expect((error as AttachmentInspectionError).code).toBe(
      ATTACHMENT_INSPECTION_ERROR_CODES.TYPE_UNSUPPORTED,
    );
    expect((error as AttachmentInspectionError).message).toContain(keyword);
  });

  it.each([
    [401, ATTACHMENT_INSPECTION_ERROR_CODES.CREDENTIAL_EXPIRED],
    [403, ATTACHMENT_INSPECTION_ERROR_CODES.CREDENTIAL_EXPIRED],
    [404, ATTACHMENT_INSPECTION_ERROR_CODES.NOT_FOUND],
    [500, ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED],
  ])("BE 返回 HTTP %i 时映射为 %s", async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status }));
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch);
    await expect(resolver.inspect(inspectInput())).rejects.toMatchObject({ code });
  });

  it("BE 对缺失文件返回 200 空 body 时按 NOT_FOUND 处理", async () => {
    const fetchImpl = vi.fn(async () => streamResponse([]));
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch);
    await expect(resolver.inspect(inspectInput())).rejects.toMatchObject({
      code: ATTACHMENT_INSPECTION_ERROR_CODES.NOT_FOUND,
    });
  });

  it("content-length 超过单文件上限直接拒绝，不落盘", async () => {
    const fetchImpl = vi.fn(async () =>
      textResponse("irrelevant", { "content-length": String(1024 * 1024) }),
    );
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch, {
      maxFileBytes: 1_024,
    });
    await expect(resolver.inspect(inspectInput())).rejects.toMatchObject({
      code: ATTACHMENT_INSPECTION_ERROR_CODES.TOO_LARGE,
    });
  });

  it("流式下载中途超过单文件上限中止并报 TOO_LARGE", async () => {
    const chunks = [
      new Uint8Array(800),
      new Uint8Array(800),
      new Uint8Array(800),
    ];
    const fetchImpl = vi.fn(async () => streamResponse(chunks));
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch, {
      maxFileBytes: 1_000,
    });
    await expect(resolver.inspect(inspectInput())).rejects.toMatchObject({
      code: ATTACHMENT_INSPECTION_ERROR_CODES.TOO_LARGE,
    });
  });

  it("文本嗅探发现 NUL 字节判定为二进制并拒绝", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([new Uint8Array([0x41, 0x00, 0x42])]),
    );
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch);
    await expect(resolver.inspect(inspectInput())).rejects.toMatchObject({
      code: ATTACHMENT_INSPECTION_ERROR_CODES.TYPE_UNSUPPORTED,
    });
  });

  it("非法 UTF-8 内容返回 FETCH_FAILED", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([new Uint8Array([0xff, 0xfe, 0x41, 0x42])]),
    );
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch);
    await expect(resolver.inspect(inspectInput())).rejects.toMatchObject({
      code: ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED,
    });
  });

  it("下载超时报 FETCH_FAILED 且清理临时目录", async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          );
        }),
    );
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch, {
      timeoutMs: 5,
    });
    await expect(
      resolver.inspect({ ...inspectInput(), signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      code: ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED,
    });
  });

  it("Run 取消（外部 signal 中止）时原样上抛中止错误且不包装", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // 与真实 fetch 一致：信号已中止时立即拒绝。
          if (init.signal?.aborted) {
            reject(new DOMException("The operation was aborted", "AbortError"));
            return;
          }
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          );
        }),
    );
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch);
    const pending = resolver.inspect(inspectInput({ signal: controller.signal }));
    controller.abort();
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });

  it("优先使用服务发现解析出的 BE 地址", async () => {
    const fetchImpl = vi.fn(async () => textResponse("ok"));
    const resolver = new ByAiAttachmentResolver({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tempDir: tempRoot,
      endpointResolver: {
        resolve: async () => "http://byclaw-be.svc:9000/prefix",
      },
    });
    await resolver.inspect(inspectInput());
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe(
      "http://byclaw-be.svc:9000/prefix/byaiService/commonFile/download?fileId=12345",
    );
  });

  it("返回结果不含内部路径与下载 URL", async () => {
    const fetchImpl = vi.fn(async () => textResponse("content"));
    const resolver = resolverOf(fetchImpl as unknown as typeof fetch);
    const result = await resolver.inspect(inspectInput());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(tempRoot);
    expect(serialized).not.toContain("commonFile/download");
    expect(serialized).not.toContain("run-scoped-token");
  });
});
