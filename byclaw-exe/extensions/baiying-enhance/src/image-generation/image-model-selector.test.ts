import { beforeEach, describe, expect, it } from "vitest";
import {
  getCachedAimodelAuthToken,
  resetAimodelAuthTokenCacheForTests,
} from "../aimodel-auth-cache.js";
import type {
  BaiyingRedisJsonStore,
  RedisJsonReadResult,
  RedisJsonPayload,
} from "../redis-json-store.js";
import {
  createImageModelCache,
  resolveImageModel,
} from "./image-model-selector.js";

type ModelDto = {
  authToken: string;
  brandId: string;
  createTime: number;
  createUser: string;
  instanceId: string;
  instanceMode: string;
  instanceName: string;
  instanceParam: Record<string, unknown>;
  maxContentToken: string;
  modelCode: string;
  providerName: string;
  modelProtocol: string;
  modelName: string;
  status: number;
  subInstance: string;
  url: string;
  userCount: number;
  username: string;
  modelType: string;
  isDefault: number;
};

function model(overrides: Partial<ModelDto> = {}): ModelDto {
  return {
    authToken: "selector-test-token",
    brandId: "minimax",
    createTime: 1_700_000_000_000,
    createUser: "test-user",
    instanceId: "11",
    instanceMode: "API",
    instanceName: "MiniMax image",
    instanceParam: {
      providerName: "MINIMAX",
      modelProtocol: "MINIMAX_IMAGE",
      connectTimeoutSec: 30,
      readTimeoutSec: 120,
      maxRetries: 2,
      retryIntervalSec: 1,
    },
    maxContentToken: "0",
    modelCode: "image-01",
    providerName: "MINIMAX",
    modelProtocol: "MINIMAX_IMAGE",
    modelName: "MiniMax image",
    status: 1,
    subInstance: "",
    url: "https://api.minimaxi.com/v1/image_generation",
    userCount: 0,
    username: "",
    modelType: "IMAGE_GENERATION",
    isDefault: 1,
    ...overrides,
  };
}

function payload(key: string, raw: unknown): RedisJsonPayload {
  const content = JSON.stringify(raw);
  return { key, content, raw, hash: `hash:${content}` };
}

function strict(value: RedisJsonPayload | null): RedisJsonReadResult {
  return value ? { status: "ok", value } : { status: "missing" };
}

function createMemoryStore(params: {
  employees?: Record<string, Record<string, unknown>>;
  models?: Record<string, ModelDto>;
  defaults?: ModelDto[];
} = {}): BaiyingRedisJsonStore {
  const employees = params.employees ?? {};
  const models = params.models ?? {};
  const defaults = params.defaults ?? [];
  return {
    getJsonByKey: async () => null,
    getJsonByKeyStrict: async () => ({ status: "missing" }),
    getDigEmployeeJson: async (resourceId) => {
      const employee = employees[resourceId];
      return employee ? payload(`DIG_EMPLOYEE_${resourceId}`, employee) : null;
    },
    getDigEmployeeJsonStrict: async (resourceId) => {
      const employee = employees[resourceId];
      return strict(employee ? payload(`DIG_EMPLOYEE_${resourceId}`, employee) : null);
    },
    getHashJson: async ({ key, field }) => {
      if (key === "byai:aimodel:config") {
        const record = models[field];
        return record ? payload(`${key}:${field}`, record) : null;
      }
      if (key === "byai:aimodel:typelist" && field === "IMAGE_GENERATION") {
        return defaults.length > 0 ? payload(`${key}:${field}`, defaults) : null;
      }
      return null;
    },
    getHashJsonStrict: async ({ key, field }) => {
      if (key === "byai:aimodel:config") {
        const record = models[field];
        return strict(record ? payload(`${key}:${field}`, record) : null);
      }
      if (key === "byai:aimodel:typelist" && field === "IMAGE_GENERATION") {
        return strict(defaults.length > 0 ? payload(`${key}:${field}`, defaults) : null);
      }
      return { status: "missing" };
    },
    getResourceJson: async () => null,
    close: async () => {},
  };
}

describe("resolveImageModel", () => {
  beforeEach(() => {
    resetAimodelAuthTokenCacheForTests();
  });

  it("uses the employee's explicit image model before the global default", async () => {
    const explicit = model({ instanceId: "22", isDefault: 0 });
    const store = createMemoryStore({ models: { "22": explicit }, defaults: [model()] });

    await expect(
      resolveImageModel({ employee: { imageModelId: "22" }, store }),
    ).resolves.toMatchObject({ modelId: "22", source: "employee" });
  });

  it("uses the IMAGE_GENERATION default only when the employee has no explicit selection", async () => {
    const store = createMemoryStore({ defaults: [model()] });

    await expect(resolveImageModel({ employee: {}, store })).resolves.toMatchObject({
      modelId: "11",
      source: "global-default",
    });
  });

  it("does not fall back when an explicit image model is missing", async () => {
    const store = createMemoryStore({ defaults: [model()] });

    await expect(
      resolveImageModel({ employee: { imageModelId: "missing" }, store }),
    ).rejects.toMatchObject({ code: "IMAGE_MODEL_UNAVAILABLE" });
  });

  it("reports an unconfigured global default", async () => {
    await expect(
      resolveImageModel({ employee: {}, store: createMemoryStore() }),
    ).rejects.toMatchObject({ code: "IMAGE_MODEL_NOT_CONFIGURED" });
  });

  it.each([
    ["disabled", { status: 0 }],
    ["wrong type", { modelType: "LLM" }],
    ["missing token", { authToken: "" }],
  ])("rejects an explicit %s model without falling back", async (_label, overrides) => {
    const invalid = model({ instanceId: "22", isDefault: 0, ...overrides });
    const store = createMemoryStore({ models: { "22": invalid }, defaults: [model()] });

    await expect(
      resolveImageModel({ employee: { imageModelId: "22" }, store }),
    ).rejects.toMatchObject({ code: "IMAGE_MODEL_UNAVAILABLE" });
  });

  it("preserves provider and protocol so the native OpenClaw router can select the adapter", async () => {
    const openai = model({
      instanceId: "22",
      modelCode: "gpt-image-1",
      providerName: "OPENAI",
      modelProtocol: "OPENAI_IMAGE",
      isDefault: 0,
    });
    const store = createMemoryStore({ models: { "22": openai } });

    await expect(
      resolveImageModel({ employee: { imageModelId: "22" }, store }),
    ).resolves.toMatchObject({
      providerName: "OPENAI",
      modelProtocol: "OPENAI_IMAGE",
    });
  });

  it("reads the employee and model again on every call so Redis changes hot-switch the model", async () => {
    const employees: Record<string, Record<string, unknown>> = {
      "employee-1": { imageModelId: "22" },
    };
    const store = createMemoryStore({
      employees,
      models: {
        "22": model({ instanceId: "22", modelCode: "image-01", isDefault: 0 }),
        "33": model({ instanceId: "33", modelCode: "image-02", isDefault: 0 }),
      },
    });
    const cache = createImageModelCache();

    await expect(
      resolveImageModel({ agent: { sourceKey: "employee-1" }, store, cache }),
    ).resolves.toMatchObject({ modelId: "22", modelCode: "image-01" });

    employees["employee-1"] = { imageModelId: "33" };

    await expect(
      resolveImageModel({ agent: { sourceKey: "employee-1" }, store, cache }),
    ).resolves.toMatchObject({ modelId: "33", modelCode: "image-02" });
  });

  it("uses only a previously validated same-selection record when Redis becomes unavailable", async () => {
    let unavailable = false;
    const base = createMemoryStore({
      models: { "22": model({ instanceId: "22", isDefault: 0 }) },
    });
    const store: BaiyingRedisJsonStore = {
      ...base,
      getHashJsonStrict: async (params) => {
        if (unavailable) {
          return { status: "transport-error" };
        }
        return base.getHashJsonStrict!(params);
      },
    };
    const cache = createImageModelCache();

    const first = await resolveImageModel({
      employee: { imageModelId: "22" },
      store,
      cache,
    });
    unavailable = true;
    const second = await resolveImageModel({
      employee: { imageModelId: "22" },
      store,
      cache,
    });

    expect(second).toEqual(first);
  });

  it("does not reuse a cached model when Redis returns an explicitly invalid record", async () => {
    const records = { "22": model({ instanceId: "22", isDefault: 0 }) };
    const store = createMemoryStore({ models: records, defaults: [model()] });
    const cache = createImageModelCache();

    await resolveImageModel({ employee: { imageModelId: "22" }, store, cache });
    records["22"] = model({ instanceId: "22", status: 0, isDefault: 0 });

    await expect(
      resolveImageModel({ employee: { imageModelId: "22" }, store, cache }),
    ).rejects.toMatchObject({ code: "IMAGE_MODEL_UNAVAILABLE" });
  });

  it("rejects a bad global default snapshot instead of reusing the last validated default", async () => {
    const defaults = [model()];
    const store = createMemoryStore({ defaults });
    const cache = createImageModelCache();
    await resolveImageModel({ employee: {}, store, cache });
    defaults[0] = model({ status: 0 });

    await expect(resolveImageModel({ employee: {}, store, cache })).rejects.toMatchObject({
      code: "IMAGE_MODEL_UNAVAILABLE",
    });
  });

  it("reuses the existing in-memory AI model secret cache for validated records", async () => {
    const store = createMemoryStore({ defaults: [model()] });

    await resolveImageModel({ employee: {}, store });

    expect(getCachedAimodelAuthToken("11")).toBe("selector-test-token");
  });

  it("does not reuse cached credentials after an explicit model is deleted", async () => {
    const records: Record<string, ModelDto> = {
      "22": model({ instanceId: "22", isDefault: 0 }),
    };
    const store = createMemoryStore({ models: records, defaults: [model()] });
    const cache = createImageModelCache();
    await resolveImageModel({ employee: { imageModelId: "22" }, store, cache });
    delete records["22"];

    await expect(
      resolveImageModel({ employee: { imageModelId: "22" }, store, cache }),
    ).rejects.toMatchObject({ code: "IMAGE_MODEL_UNAVAILABLE" });
    expect(getCachedAimodelAuthToken("22")).toBeNull();
  });

  it("does not reuse a deleted employee's cached selection", async () => {
    const employees: Record<string, Record<string, unknown>> = {
      "employee-1": { imageModelId: "22" },
    };
    const store = createMemoryStore({
      employees,
      models: { "22": model({ instanceId: "22", isDefault: 0 }) },
    });
    const cache = createImageModelCache();
    await resolveImageModel({ agent: { sourceKey: "employee-1" }, store, cache });
    delete employees["employee-1"];

    await expect(
      resolveImageModel({ agent: { sourceKey: "employee-1" }, store, cache }),
    ).rejects.toMatchObject({ code: "IMAGE_MODEL_UNAVAILABLE" });
  });

  it("uses LKG only for a strict transport error and rejects malformed explicit JSON", async () => {
    const base = createMemoryStore({
      models: { "22": model({ instanceId: "22", isDefault: 0 }) },
    });
    const cache = createImageModelCache();
    await resolveImageModel({ employee: { imageModelId: "22" }, store: base, cache });
    const malformed: BaiyingRedisJsonStore = {
      ...base,
      getHashJsonStrict: async () => ({ status: "malformed" }),
    };

    await expect(
      resolveImageModel({ employee: { imageModelId: "22" }, store: malformed, cache }),
    ).rejects.toMatchObject({ code: "IMAGE_MODEL_UNAVAILABLE" });
  });
});
