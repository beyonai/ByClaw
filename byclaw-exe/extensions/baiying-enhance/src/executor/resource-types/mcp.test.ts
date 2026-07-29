import { describe, expect, it } from "vitest";
import { buildOntologyCallAgentPayload } from "./mcp.js";

describe("buildOntologyCallAgentPayload", () => {
  it("adds resource_ids alongside OBJECT resource codes", () => {
    const payload = buildOntologyCallAgentPayload(
      {
        query: "ignored",
        arguments: {
          page: 1,
          call_object_ids: ["stale_object_code"],
          resource_ids: ["stale_resource_id"],
        },
      },
      {
        resourceType: "OBJECT",
        resourceCode: "po_users",
        resourceId: "10000018",
      },
    );

    expect(payload).toMatchObject({
      page: 1,
      call_object_ids: ["po_users"],
      resource_ids: ["10000018"],
    });
    expect(payload.query).toBeUndefined();
  });

  it("adds resource_ids alongside VIEW resource codes", () => {
    const payload = buildOntologyCallAgentPayload(
      { arguments: { ownerUserCode: "0027003729" } },
      {
        resourceType: "VIEW",
        resourceCode: "todo_view",
        resourceId: "10810924",
      },
    );

    expect(payload).toMatchObject({
      ownerUserCode: "0027003729",
      call_view_ids: ["todo_view"],
      resource_ids: ["10810924"],
    });
  });
});
