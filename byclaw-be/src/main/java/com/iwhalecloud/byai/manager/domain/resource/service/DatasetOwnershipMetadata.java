package com.iwhalecloud.byai.manager.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.parser.Feature;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import org.apache.commons.lang3.StringUtils;

/** Server-owned creation provenance in existing source_content; never accepted from an import or published to runtime. */
public final class DatasetOwnershipMetadata {
    private static final String KEY = "_byclawKnowledgeOwnership";

    private DatasetOwnershipMetadata() { }

    public static boolean isLocal(SsResExtDoc document) {
        if (document == null || document.getResourceId() == null || StringUtils.isBlank(document.getSourceContent())) {
            return false;
        }
        try {
            JSONObject source = JSON.parseObject(document.getSourceContent());
            Object value = source == null ? null : source.get(KEY);
            return value instanceof JSONObject marker && "BYAI".equals(marker.getString("source"))
                && document.getResourceId().toString().equals(marker.getString("resourceId"));
        } catch (RuntimeException exception) {
            // Historical source content without a valid marker keeps its existing external synchronization rules.
            return false;
        }
    }

    public static String markLocal(String sourceContent, Long resourceId) {
        JSONObject source = object(sourceContent);
        JSONObject marker = new JSONObject(true);
        marker.put("source", "BYAI");
        marker.put("resourceId", resourceId.toString());
        source.put(KEY, marker);
        return source.toJSONString();
    }

    public static String stripLocalMarker(String content) {
        JSONObject source = object(content);
        if (!source.containsKey(KEY)) return content;
        source.remove(KEY);
        return source.toJSONString();
    }

    public static String applyScope(String targetContent, String ownerType, Long catalogId) {
        JSONObject target = object(targetContent);
        target.remove(KEY);
        target.put("ownerType", ownerType);
        target.put("catalogId", catalogId);
        return target.toJSONString();
    }

    private static JSONObject object(String content) {
        JSONObject result = StringUtils.isBlank(content) ? null : JSON.parseObject(content, Feature.OrderedField);
        return result == null ? new JSONObject(true) : result;
    }
}
