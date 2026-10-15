package com.iwhalecloud.byai.manager.dto.resource;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import java.math.BigDecimal;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Field presence is part of the synchronization contract; absent and false are different operations. */
public record EnterpriseResourceSyncRequest(Boolean viewAuth, Boolean autoAuthorize, Scope scope) {
    public static final Set<String> TYPES = Set.of("TOOLKIT", "MCP", "AGENT", "KG_DOC", "KG_DB", "KG_QA",
        "KG_TERM", "SKILL");

    public static EnterpriseResourceSyncRequest parse(JSONObject json) {
        if (!TYPES.contains(json.getString("resourceBizType"))) {
            throw new IllegalArgumentException("不支持的同步资源类型");
        }
        if (json.containsKey("ownerType") && !"enterprise".equals(json.get("ownerType"))) {
            throw new IllegalArgumentException("同步资源必须归属企业");
        }
        json.put("ownerType", "enterprise");
        Boolean view = flag(json, "viewAuth");
        Boolean auto = flag(json, "autoAuthorize");
        Scope scope = null;
        if (json.containsKey("authScope")) {
            if (!(json.get("authScope") instanceof JSONObject object)) {
                throw new IllegalArgumentException("authScope 必须是对象且不能为 null");
            }
            if (!Set.of("userIds", "orgIds", "postIds").containsAll(object.keySet())) {
                throw new IllegalArgumentException("authScope 含未知字段");
            }
            scope = new Scope(ids(object, "userIds"), ids(object, "orgIds"), ids(object, "postIds"));
        }
        if ((Boolean.TRUE.equals(view) || Boolean.TRUE.equals(auto)) && scope == null) {
            throw new IllegalArgumentException("开启查看或自动授权必须提供 authScope");
        }
        if (scope != null && view == null && auto == null) {
            throw new IllegalArgumentException("authScope 必须与授权开关一起传入");
        }
        return new EnterpriseResourceSyncRequest(view, auto, scope);
    }

    private static Boolean flag(JSONObject json, String field) {
        if (!json.containsKey(field)) return null;
        if (!(json.get(field) instanceof Boolean value)) {
            throw new IllegalArgumentException(field + " 必须是 boolean 且不能为 null");
        }
        return value;
    }

    private static List<Long> ids(JSONObject json, String field) {
        if (!json.containsKey(field)) return List.of();
        if (!(json.get(field) instanceof JSONArray values)) {
            throw new IllegalArgumentException(field + " 必须是数组且不能为 null");
        }
        LinkedHashSet<Long> ids = new LinkedHashSet<>();
        for (Object value : values) {
            String text = value == null ? "" : value.toString();
            if (!(value instanceof String || value instanceof Number) || !text.matches("[0-9]+")) {
                throw new IllegalArgumentException(field + " 含非法 ID");
            }
            try {
                long id = new BigDecimal(text).longValueExact();
                if (id <= 0) throw new ArithmeticException();
                ids.add(id);
            } catch (ArithmeticException exception) {
                throw new IllegalArgumentException(field + " 含超出范围的 ID");
            }
        }
        return List.copyOf(ids);
    }

    public record Scope(List<Long> userIds, List<Long> orgIds, List<Long> postIds) { }
}
