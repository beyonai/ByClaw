package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.stereotype.Service;

/** 租户群数据的协议适配；不包含平台资源、文件或聊天调度逻辑。 */
@Service
public class TenantGroupData {
    private final TenantNodeClient node;

    public TenantGroupData(TenantNodeClient node) { this.node = node; }

    public JsonNode read(TenantRequestContext tenant, String path) {
        return node.request(tenant, "GET", "/internal/v1/" + path, null, new TypeReference<JsonNode>() {});
    }

    public JsonNode query(TenantRequestContext tenant, String path, Object body) {
        return node.request(tenant, "POST", "/internal/v1/" + path, body, new TypeReference<JsonNode>() {});
    }

    public TenantNodeModels.CommandResult write(TenantRequestContext tenant, String method, String suffix,
        String groupId, String operation, Map<String, Object> payload) {
        return node.command(tenant, method, "/internal/v1/group-chats/" + groupId + suffix, groupId,
            operation, new TenantNodeModels.Fields(payload), java.util.UUID.randomUUID().toString(),
            ("SET_ROLE".equals(operation) || "TRANSFER_OWNER".equals(operation))
                ? java.util.stream.Stream.of(Long.toString(tenant.userId()), payload.get("userId").toString()).distinct().toList()
                : java.util.List.of(Long.toString(tenant.userId())));
    }
}
