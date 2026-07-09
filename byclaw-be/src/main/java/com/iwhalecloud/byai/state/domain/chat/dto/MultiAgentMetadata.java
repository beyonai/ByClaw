package com.iwhalecloud.byai.state.domain.chat.dto;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class MultiAgentMetadata {

    public static final String EXT_KEY_CAMEL = "multiAgent";

    public static final String EXT_KEY_SNAKE = "multi_agent";

    private String turnId;

    private String mode;

    private List<Lane> lanes = new ArrayList<>();

    public static MultiAgentMetadata fromExtParams(Map<String, Object> extParams) {
        MultiAgentMetadata metadata = new MultiAgentMetadata();
        if (extParams == null || extParams.isEmpty()) {
            return metadata;
        }

        Object raw = extParams.get(EXT_KEY_CAMEL);
        if (raw == null) {
            raw = extParams.get(EXT_KEY_SNAKE);
        }
        JSONObject root = toJSONObject(raw);
        if (root == null || root.isEmpty()) {
            return metadata;
        }

        metadata.setTurnId(getString(root, "turnId", "turn_id"));
        metadata.setMode(getString(root, "mode", "mode"));

        JSONArray lanesJson = root.getJSONArray("lanes");
        if (lanesJson == null || lanesJson.isEmpty()) {
            return metadata;
        }
        for (int i = 0; i < lanesJson.size(); i++) {
            JSONObject laneJson = toJSONObject(lanesJson.get(i));
            if (laneJson == null) {
                continue;
            }
            Lane lane = new Lane();
            lane.setLaneId(getString(laneJson, "laneId", "lane_id"));
            lane.setAgentId(getLong(laneJson, "agentId", "agent_id"));
            lane.setAgentCode(getString(laneJson, "agentCode", "agent_code"));
            lane.setAgentName(getString(laneJson, "agentName", "agent_name"));
            lane.setClientRequestId(getString(laneJson, "clientRequestId", "client_request_id"));
            lane.setQueryMessageId(getString(laneJson, "queryMessageId", "query_message_id"));
            lane.setAnswerMessageId(getString(laneJson, "answerMessageId", "answer_message_id"));
            lane.setOrder(getInteger(laneJson, "order", "order"));
            lane.setDependsOn(laneJson.get("dependsOn") == null ? laneJson.get("depends_on")
                : laneJson.get("dependsOn"));
            metadata.getLanes().add(lane);
        }
        return metadata;
    }

    public boolean hasLanes() {
        return lanes != null && !lanes.isEmpty();
    }

    public List<Lane> orderedLanes() {
        List<Lane> ordered = lanes == null ? new ArrayList<>() : new ArrayList<>(lanes);
        ordered.sort(Comparator.comparing(Lane::getOrder, Comparator.nullsLast(Integer::compareTo)));
        return ordered;
    }

    public JSONObject buildLanePayload(Lane lane, String traceId) {
        JSONObject payload = new JSONObject();
        putIfNotBlank(payload, "turnId", turnId);
        putIfNotBlank(payload, "mode", mode);
        if (lane != null) {
            putIfNotBlank(payload, "laneId", lane.getLaneId());
            putIfNotBlank(payload, "clientRequestId", lane.getClientRequestId());
            putIfNotBlank(payload, "queryMessageId", lane.getQueryMessageId());
            putIfNotBlank(payload, "answerMessageId", lane.getAnswerMessageId());
            putIfNotBlank(payload, "agentCode", lane.getAgentCode());
            putIfNotBlank(payload, "agentName", lane.getAgentName());
            if (lane.getAgentId() != null) {
                payload.put("agentId", lane.getAgentId());
            }
            if (lane.getOrder() != null) {
                payload.put("order", lane.getOrder());
            }
            if (lane.getDependsOn() != null) {
                payload.put("dependsOn", lane.getDependsOn());
            }
        }
        putIfNotBlank(payload, "traceId", traceId);
        return payload;
    }

    public static JSONObject toJSONObject(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof JSONObject) {
            return (JSONObject) raw;
        }
        if (raw instanceof Map) {
            JSONObject jsonObject = new JSONObject();
            ((Map<?, ?>) raw).forEach((key, value) -> {
                if (key != null) {
                    jsonObject.put(String.valueOf(key), value);
                }
            });
            return jsonObject;
        }
        if (raw instanceof String) {
            String value = ((String) raw).trim();
            if (StringUtils.isBlank(value)) {
                return null;
            }
            try {
                return JSON.parseObject(value);
            }
            catch (Exception ignored) {
                return null;
            }
        }
        Object json = JSON.toJSON(raw);
        return json instanceof JSONObject ? (JSONObject) json : null;
    }

    private static String getString(JSONObject jsonObject, String camelKey, String snakeKey) {
        if (jsonObject == null) {
            return null;
        }
        Object value = jsonObject.get(camelKey);
        if (value == null) {
            value = jsonObject.get(snakeKey);
        }
        return value == null ? null : String.valueOf(value);
    }

    private static Long getLong(JSONObject jsonObject, String camelKey, String snakeKey) {
        Object value = getObject(jsonObject, camelKey, snakeKey);
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        try {
            String stringValue = value == null ? null : String.valueOf(value);
            return StringUtils.isBlank(stringValue) ? null : Long.valueOf(stringValue);
        }
        catch (Exception e) {
            return null;
        }
    }

    private static Integer getInteger(JSONObject jsonObject, String camelKey, String snakeKey) {
        Object value = getObject(jsonObject, camelKey, snakeKey);
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        try {
            String stringValue = value == null ? null : String.valueOf(value);
            return StringUtils.isBlank(stringValue) ? null : Integer.valueOf(stringValue);
        }
        catch (Exception e) {
            return null;
        }
    }

    private static Object getObject(JSONObject jsonObject, String camelKey, String snakeKey) {
        if (jsonObject == null) {
            return null;
        }
        Object value = jsonObject.get(camelKey);
        return value == null ? jsonObject.get(snakeKey) : value;
    }

    private static void putIfNotBlank(JSONObject jsonObject, String key, String value) {
        if (StringUtils.isNotBlank(value)) {
            jsonObject.put(key, value);
        }
    }

    @Getter
    @Setter
    public static class Lane {

        private String laneId;

        private Long agentId;

        private String agentCode;

        private String agentName;

        private String clientRequestId;

        private String queryMessageId;

        private String answerMessageId;

        private Integer order;

        private Object dependsOn;
    }
}
