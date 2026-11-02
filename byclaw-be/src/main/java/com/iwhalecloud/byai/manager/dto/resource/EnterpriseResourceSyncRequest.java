package com.iwhalecloud.byai.manager.dto.resource;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

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

    // Import endpoints return validation messages directly, so resolve them in the request locale.
    public static EnterpriseResourceSyncRequest parse(JSONObject json) {
        if (!TYPES.contains(json.getString("resourceBizType"))) {
            throw new IllegalArgumentException(I18nUtil.get("resource.sync.type.unsupported"));
        }
        if (json.containsKey("ownerType") && !"enterprise".equals(json.get("ownerType"))) {
            throw new IllegalArgumentException(I18nUtil.get("resource.sync.owner.invalid"));
        }
        json.put("ownerType", "enterprise");
        Boolean view = flag(json, "viewAuth");
        Boolean auto = flag(json, "autoAuthorize");
        Scope scope = null;
        if (json.containsKey("authScope")) {
            if (!(json.get("authScope") instanceof JSONObject object)) {
                throw new IllegalArgumentException(I18nUtil.get("resource.sync.scope.object.required"));
            }
            if (!Set.of("userIds", "orgIds", "postIds").containsAll(object.keySet())) {
                throw new IllegalArgumentException(I18nUtil.get("resource.sync.scope.fields.invalid"));
            }
            scope = new Scope(ids(object, "userIds"), ids(object, "orgIds"), ids(object, "postIds"));
        }
        if ((Boolean.TRUE.equals(view) || Boolean.TRUE.equals(auto)) && scope == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.sync.scope.required"));
        }
        if (scope != null && view == null && auto == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.sync.scope.flags.required"));
        }
        return new EnterpriseResourceSyncRequest(view, auto, scope);
    }

    private static Boolean flag(JSONObject json, String field) {
        if (!json.containsKey(field)) return null;
        if (!(json.get(field) instanceof Boolean value)) {
            throw new IllegalArgumentException(I18nUtil.get("resource.sync.flag.invalid", field));
        }
        return value;
    }

    private static List<Long> ids(JSONObject json, String field) {
        if (!json.containsKey(field)) return List.of();
        if (!(json.get(field) instanceof JSONArray values)) {
            throw new IllegalArgumentException(I18nUtil.get("resource.sync.ids.array.required", field));
        }
        LinkedHashSet<Long> ids = new LinkedHashSet<>();
        for (Object value : values) {
            String text = value == null ? "" : value.toString();
            if (!(value instanceof String || value instanceof Number) || !text.matches("[0-9]+")) {
                throw new IllegalArgumentException(I18nUtil.get("resource.sync.id.invalid", field));
            }
            try {
                long id = new BigDecimal(text).longValueExact();
                if (id <= 0) throw new ArithmeticException();
                ids.add(id);
            } catch (ArithmeticException exception) {
                throw new IllegalArgumentException(I18nUtil.get("resource.sync.id.out.of.range", field));
            }
        }
        return List.copyOf(ids);
    }

    public record Scope(List<Long> userIds, List<Long> orgIds, List<Long> postIds) { }
}
