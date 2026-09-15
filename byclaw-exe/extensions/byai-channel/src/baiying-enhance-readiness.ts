export { waitForBaiyingEnhanceColdStartReady } from "../../shared/src/baiying-enhance-readiness.js";

export function isBaiyingEnhanceConfigured(cfg: {
  plugins?: {
    entries?: Record<string, unknown>;
    load?: { paths?: string[] };
  };
}): boolean {
  if (cfg.plugins?.entries && Object.prototype.hasOwnProperty.call(cfg.plugins.entries, "baiying-enhance")) {
    const entry = cfg.plugins.entries["baiying-enhance"];
    return !(
      entry &&
      typeof entry === "object" &&
      "enabled" in entry &&
      entry.enabled === false
    );
  }
  return (cfg.plugins?.load?.paths ?? []).some((entry) => entry.includes("baiying-enhance"));
}
