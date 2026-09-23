package com.iwhalecloud.byai.state.domain.groupchat.domain;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONException;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;

/** 在群列表和历史文件读取边界还原成员名称，不修改持久化正文或成员引用。 */
public final class GroupChatMessagePreview {
    private static final Pattern MENTION = Pattern.compile(
        "\\{\\{((?:DIG_EMPLOYEE|HUMAN)_[1-9]\\d*)}}|\\[@([^]\\r\\n]+)]\\(uid=([^()\\s]+)\\)");

    private GroupChatMessagePreview() {
    }

    public static String format(String content, List<ResourceVo> resources) {
        if (content == null || content.isEmpty()) {
            return content;
        }
        Map<String, String> names = new LinkedHashMap<>();
        if (resources != null) {
            for (ResourceVo resource : resources) {
                if (resource == null || (resource.getResourceType() != AgentMetaEnum.HUMAN
                    && resource.getResourceType() != AgentMetaEnum.DIG_EMPLOYEE)
                    || resource.getResourceName() == null || resource.getResourceName().isBlank()) {
                    continue;
                }
                names.putIfAbsent(resource.getResourceType().getCode() + "_" + resource.getResourceId(),
                    resource.getResourceName());
            }
        }
        Matcher matcher = MENTION.matcher(content);
        StringBuffer result = new StringBuffer();
        while (matcher.find()) {
            String uid = matcher.group(1) == null ? matcher.group(3) : matcher.group(1);
            // Markdown 自带名称可兜底；无法解析名称的占位符保留原文，不猜测成员身份。
            String name = names.getOrDefault(uid, matcher.group(2));
            matcher.appendReplacement(result, Matcher.quoteReplacement(name == null ? matcher.group() : "@" + name));
        }
        matcher.appendTail(result);
        return result.toString();
    }

    public static String fromMetadata(String content, String metadata) {
        if (metadata == null || metadata.isBlank()) {
            return format(content, null);
        }
        try {
            JSONObject object = JSON.parseObject(metadata);
            if (object == null) {
                return format(content, null);
            }
            // 使用消息已有的资源名称快照，不额外查询成员，也不回填数据库。
            return format(content, object.getJSONArray("resourceList") == null ? null
                : object.getJSONArray("resourceList").toJavaList(ResourceVo.class));
        }
        catch (JSONException ignored) {
            return format(content, null);
        }
    }
}
