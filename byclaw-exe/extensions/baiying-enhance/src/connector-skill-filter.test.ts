import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveConnectorSkillFilter,
  setConnectorSkillFilterResolver,
} from "../../shared/src/connector-skill-filter-runtime.js";

describe("connector skill filter runtime", () => {
  afterEach(() => {
    setConnectorSkillFilterResolver(undefined);
  });

  it("shares a connector skill filter resolver across extension bundles", async () => {
    setConnectorSkillFilterResolver(undefined);
    await expect(
      resolveConnectorSkillFilter({
        agentId: "baiying-agent-1",
        disabledConnectorSkills: ["fws"],
      }),
    ).resolves.toBeUndefined();

    const resolver = vi.fn(async () => ["dws", "ordinary-skill"]);
    setConnectorSkillFilterResolver(resolver);

    await expect(
      resolveConnectorSkillFilter({
        agentId: "baiying-agent-1",
        disabledConnectorSkills: ["fws"],
      }),
    ).resolves.toEqual(["dws", "ordinary-skill"]);
    expect(resolver).toHaveBeenCalledWith({
      agentId: "baiying-agent-1",
      disabledConnectorSkills: ["fws"],
    });
  });
});
