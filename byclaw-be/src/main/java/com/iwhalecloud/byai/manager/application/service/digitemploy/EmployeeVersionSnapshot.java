package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.serializer.SerializerFeature;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** 配置白名单。权限、运行态、用户私有记忆和连接/机器人凭证不进入历史。 */
public final class EmployeeVersionSnapshot {
    public static final int SCHEMA = 1;
    public static final List<String> FIELDS = List.of("resourceName", "resourceDesc", "avatar", "sample", "tags", "catalogId", "openSuperHelper",
        "agentType", "ability", "constraints", "faqs", "roleAttributes", "processingFlow", "personalityDimensions",
        "wordPreferences", "sentenceAndTone", "terminal", "coreCompetencies", "corePersonaDefinition",
        "advancedSettings", "ttsModelId", "imageModelId", "relPrompt", "relIds", "relResourceInfoList",
        "relTools", "employeeGroupMembers", "prologue", "relSkills");
    private EmployeeVersionSnapshot() { }

    public static JSONObject configuration(DigitalEmployeeDTO employee) {
        JSONObject all = (JSONObject) JSON.toJSON(employee);
        JSONObject result = new JSONObject(true);
        for (String field : FIELDS) result.put(field, all.get(field));
        // 模型配置只保存模型标识/参数，不保存详情接口可能回传的服务凭证。
        JSONObject prologue = object(employee.getPrologue());
        JSONObject safe = select(prologue, List.of("descText", "role", "openingQuestion", "modelId"));
        safe.put("modelInfo", select(prologue.getJSONObject("modelInfo"), List.of("modelId", "modelName", "model", "history", "maxToken",
            "temperature", "topP", "maxTokens", "presencePenalty", "frequencyPenalty", "enableThinking")));
        result.put("prologue", safe.toJSONString());
        JSONArray skills = new JSONArray();
        if (employee.getRelSkills() != null) for (Object skill : employee.getRelSkills()) {
            if (skill instanceof String) skills.add(skill);
            else skills.add(select((JSONObject) JSON.toJSON(skill), List.of("resourceId", "skillId", "skillCode",
                "skillType", "resourceName", "name", "versionId")));
        }
        result.put("relSkills", skills);
        return result;
    }

    public static String encode(DigitalEmployeeDTO employee) {
        JSONObject root = new JSONObject(true);
        root.put("configuration", configuration(employee));
        root.put("snapshotSchemaVersion", SCHEMA);
        if ("017".equals(employee.getAgentType())) {
            // 兼容员工组既有运行协议，运行端从同一条不可变版本读取成员和提示词。
            root.put("schemaVersion", "byclaw.digital-employee-group-runtime/v1");
            root.put("prompt", employee.getCorePersonaDefinition());
            JSONObject prologue = object(employee.getPrologue());
            JSONObject model = prologue.getJSONObject("modelInfo");
            root.put("modelId", model == null ? prologue.getString("modelId") : model.getString("modelId"));
            root.put("members", employee.getEmployeeGroupMembers());
        }
        return JSON.toJSONString(canonical(root), SerializerFeature.WriteMapNullValue);
    }

    public static JSONObject decode(String json) {
        JSONObject root = JSON.parseObject(json);
        if (root == null || !Integer.valueOf(SCHEMA).equals(root.getInteger("snapshotSchemaVersion"))
            || root.getJSONObject("configuration") == null) throw new BaseException("该历史版本不是可恢复的完整配置快照");
        return root.getJSONObject("configuration");
    }

    public static DigitalEmployeeDTO restore(String json, DigitalEmployeeDTO current) {
        JSONObject merged = (JSONObject) JSON.toJSON(current);
        JSONObject configuration = decode(json);
        for (String field : FIELDS) merged.put(field, configuration.get(field));
        // 用户私有记忆不随共享版本切换；运行镜像重新生成，版本指针只由服务端设置。
        merged.remove("memoryConfigList"); merged.remove("targetContent");
        merged.remove("resourceDVerid"); merged.remove("resourceRVerid");
        return merged.toJavaObject(DigitalEmployeeDTO.class);
    }

    public static String hash(String json) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static JSONObject object(String value) {
        if (value == null || value.isBlank()) return new JSONObject();
        try { return JSON.parseObject(value); } catch (RuntimeException e) { throw new BaseException("模型配置格式不正确"); }
    }
    private static JSONObject select(JSONObject source, List<String> keys) {
        JSONObject result = new JSONObject(true);
        if (source != null) for (String key : keys) if (source.containsKey(key)) result.put(key, source.get(key));
        return result;
    }
    private static Object canonical(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            map.forEach((key, child) -> sorted.put(String.valueOf(key), canonical(child)));
            return sorted;
        }
        if (value instanceof List<?> list) return list.stream().map(EmployeeVersionSnapshot::canonical).toList();
        return value;
    }
}
