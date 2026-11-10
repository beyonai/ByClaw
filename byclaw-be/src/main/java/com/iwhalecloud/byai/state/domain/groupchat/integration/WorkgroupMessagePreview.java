package com.iwhalecloud.byai.state.domain.groupchat.integration;

import java.util.HashSet;
import java.util.Set;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Getter;

/** 面向已授权接收人的有限纯文本摘要，不携带附件地址、引用正文或内部推理。 */
@Getter
public final class WorkgroupMessagePreview {
    private final String groupName;
    private final String senderName;
    private final String senderType;
    private final String text;
    private final boolean attachments;

    /**
     * 只投影公开正文，资源名称取本条消息的明确快照；长度按 Unicode 码点限制。
     * @param groupName 当前工作组名称
     * @param senderName 实际发言人的展示名称
     * @param senderType USER、AGENT、SYSTEM 或 UNKNOWN
     * @param content 公开消息正文
     * @param resources 本条消息的结构化资源
     * @param attachments 是否包含附件，不传递下载地址
     */
    public WorkgroupMessagePreview(String groupName, String senderName, String senderType,
        String content, JsonNode resources, boolean attachments) {
        this.groupName = plainText(groupName, 64);
        this.senderName = plainText(senderName, 32);
        this.senderType = Set.of("USER", "AGENT", "SYSTEM").contains(senderType == null ? "" : senderType)
            ? senderType : "UNKNOWN";
        String resolved = content == null ? "" : content;
        Set<String> replaced = new HashSet<>();
        if (resources != null && resources.isArray()) {
            for (JsonNode resource : resources) {
                String id = resource.path("id").asText("");
                String name = resource.path("resourceName").asText("");
                if (!id.isBlank() && !name.isBlank() && replaced.add(id)) {
                    String type = resource.path("resourceType").asText("");
                    String prefix = "HUMAN".equals(type) || "DIG_EMPLOYEE".equals(type) ? "@" : "#";
                    resolved = resolved.replace("{{" + id + "}}", prefix + name);
                }
            }
        }
        this.text = plainText(resolved, 160);
        this.attachments = attachments;
    }

    /** 通知为纯文本；不输出 HTML 标签、Markdown 链接目标或不可见控制字符。 */
    private static String plainText(String value, int limit) {
        String text = (value == null ? "" : value)
            .replaceAll("(?is)<(script|style)\\b[^>]*>.*?</\\1\\s*>", " ")
            .replaceAll("<[^>]*>", " ")
            .replaceAll("!?\\[([^]\\r\\n]*)]\\([^\\r\\n)]*\\)", "$1")
            .replaceAll("[\\p{Cc}\\u202a-\\u202e\\u2066-\\u2069]", " ")
            .replaceAll("[\\s\\p{Z}]+", " ").strip();
        int count = text.codePointCount(0, text.length());
        return count <= limit ? text : text.substring(0, text.offsetByCodePoints(0, limit - 1)) + "…";
    }
}
