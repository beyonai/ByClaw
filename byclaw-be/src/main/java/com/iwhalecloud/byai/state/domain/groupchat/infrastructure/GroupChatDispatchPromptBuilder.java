package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import org.springframework.stereotype.Component;

/** 构造只发送给 Agent、不会持久化为用户正文的请求级控制提示。 */
@Component
public class GroupChatDispatchPromptBuilder {
    public static final String SCHEMA_VERSION = "1";

    public String append(String content, Long dispatchId, Long candidateSessionId) {
        String path = "/by/.sessions/" + candidateSessionId + "/.byclaw/group-chat-disposition.json";
        return content + "\n\n[群聊判定协议 - 强制]\n"
            + "在输出任何正文前，必须判断本次请求是 TASK 还是 CHAT，并先写入文件：" + path + "。\n"
            + "需要生成或修改文件、报告、表格等交付物的请求至少应判为 TASK；问答判为 CHAT。\n"
            + "文件必须是 JSON：{\"schemaVersion\":\"1\",\"dispatchId\":\"" + dispatchId
            + "\",\"kind\":\"TASK|CHAT\",\"taskName\":\"TASK 时必填\",\"ackText\":\"TASK 时可选\"}。\n"
            + "无论判定结果为何都必须写文件；写入后继续正常处理原始请求。";
    }
}
