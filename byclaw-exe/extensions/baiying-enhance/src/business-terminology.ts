import type { BaiyingRedisJsonStore } from "./redis-json-store.js";

export const BUSINESS_TERMINOLOGY_REDIS_KEY = "byai:SystemConfig:paramCode";
export const BUSINESS_TERMINOLOGY_CONFIG_CODE = "DIGITAL_EMPLOYEE_TERMINOLOGY";

export type BusinessTerminology = {
  zhCN: { singular: string; plural: string; entry: string; market: string };
  enUS: { singular: string; plural: string; entry: string; market: string };
};

export const DEFAULT_BUSINESS_TERMINOLOGY: BusinessTerminology = {
  zhCN: { singular: "数字员工", plural: "数字员工", entry: "员工", market: "员工市场" },
  enUS: {
    singular: "Digital Employee",
    plural: "Digital Employees",
    entry: "Employees",
    market: "Employee Marketplace",
  },
};

function normalized(value: unknown, fallback: string): string {
  return typeof value === "string" &&
    value.trim() &&
    value.trim().length <= 40 &&
    !/[{}<>\r\n]/.test(value.trim())
    ? value.trim()
    : fallback;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

export function parseBusinessTerminology(value: unknown): BusinessTerminology {
  let parsed = parseJson(value);
  if (parsed && typeof parsed === "object" && "paramValue" in parsed) {
    parsed = parseJson((parsed as { paramValue?: unknown }).paramValue);
  }
  const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const zhCN = root["zh-CN"] && typeof root["zh-CN"] === "object"
    ? (root["zh-CN"] as Record<string, unknown>)
    : {};
  const enUS = root["en-US"] && typeof root["en-US"] === "object"
    ? (root["en-US"] as Record<string, unknown>)
    : {};

  return {
    zhCN: {
      singular: normalized(zhCN.singular, DEFAULT_BUSINESS_TERMINOLOGY.zhCN.singular),
      plural: normalized(zhCN.plural, DEFAULT_BUSINESS_TERMINOLOGY.zhCN.plural),
      entry: normalized(zhCN.entry, DEFAULT_BUSINESS_TERMINOLOGY.zhCN.entry),
      market: normalized(zhCN.market, DEFAULT_BUSINESS_TERMINOLOGY.zhCN.market),
    },
    enUS: {
      singular: normalized(enUS.singular, DEFAULT_BUSINESS_TERMINOLOGY.enUS.singular),
      plural: normalized(enUS.plural, DEFAULT_BUSINESS_TERMINOLOGY.enUS.plural),
      entry: normalized(enUS.entry, DEFAULT_BUSINESS_TERMINOLOGY.enUS.entry),
      market: normalized(enUS.market, DEFAULT_BUSINESS_TERMINOLOGY.enUS.market),
    },
  };
}

export async function loadBusinessTerminology(
  redisJsonStore: BaiyingRedisJsonStore,
): Promise<BusinessTerminology> {
  try {
    const payload = await redisJsonStore.getHashJson?.({
      key: BUSINESS_TERMINOLOGY_REDIS_KEY,
      field: BUSINESS_TERMINOLOGY_CONFIG_CODE,
    });
    return parseBusinessTerminology(payload?.raw);
  } catch {
    return DEFAULT_BUSINESS_TERMINOLOGY;
  }
}

function replaceAll(text: string, source: string, replacement: string): string {
  return text.split(source).join(replacement);
}

function withIndefiniteArticle(term: string): string {
  return `${/^[aeiou]/i.test(term) ? "an" : "a"} ${term}`;
}

export function replaceBusinessTerminology(
  text: string,
  terminology: BusinessTerminology = DEFAULT_BUSINESS_TERMINOLOGY,
): string {
  const singularLower = terminology.enUS.singular.toLocaleLowerCase("en-US");
  const articleReplacements = [
    ["A Digital Employee", withIndefiniteArticle(terminology.enUS.singular).replace(/^a/, "A")],
    ["a Digital Employee", withIndefiniteArticle(terminology.enUS.singular)],
    ["A digital employee", withIndefiniteArticle(singularLower).replace(/^a/, "A")],
    ["a digital employee", withIndefiniteArticle(singularLower)],
  ].reduce((result, [source, replacement]) => replaceAll(result, source, replacement), text);

  return [
    [DEFAULT_BUSINESS_TERMINOLOGY.zhCN.market, terminology.zhCN.market],
    [DEFAULT_BUSINESS_TERMINOLOGY.zhCN.singular, terminology.zhCN.singular],
    [DEFAULT_BUSINESS_TERMINOLOGY.enUS.plural, terminology.enUS.plural],
    ["Digital employees", terminology.enUS.plural],
    [DEFAULT_BUSINESS_TERMINOLOGY.enUS.singular, terminology.enUS.singular],
    ["Digital employee", terminology.enUS.singular],
    [DEFAULT_BUSINESS_TERMINOLOGY.enUS.plural.toLowerCase(), terminology.enUS.plural.toLowerCase()],
    [DEFAULT_BUSINESS_TERMINOLOGY.enUS.singular.toLowerCase(), singularLower],
  ].reduce((result, [source, replacement]) => replaceAll(result, source, replacement), articleReplacements);
}
