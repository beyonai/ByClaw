package com.iwhalecloud.byai.state.common.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum AgentTypeEnum {

    // 通用智能体
    AGENT("agent", "001", "${APP_AGENT_URL}"),
    // 文档问答类智能体
    DOC_AGENT("doc_agent", "006", "${APP_AGENT_URL}"),
    // 数据问答类智能体
    DB_AGENT("db_agent", "007", "${APP_AGENT_URL}"),
    // 插件类智能体
    API_AGENT("api_agent", "005", "${APP_AGENT_URL}"),
    // chatbi
    CHATBI("chatbi", "002", "${APP_CHATBI_URL}"),
    // 写作
    WRITER("writer", "003", "${APP_AIWRITE_URL}"),
    // 数字人
    DIGHUM("dighum", "004", "${APP_DH_URL}"),
    // // mcp服务
    // MCP_AGENT("mcpagent", "008", ""),
    // // 数字员工
    // DIG_EMPLOYEE("dig_employee", "009", ""),
    // bot智能体
    BOT_AGENT("botagent", "010", ""),

    /**
     * 个人知识库问答助手 personal_qa_agent
     */
    PERSONAL_QA_AGENT("personal_qa_agent", "011", ""),

    /**
     * 联网搜索数字员工
     */
    ONLINE_SEARCH_AGENT("online_search_agent", "012", "");

    private String name;

    private String nameCode;

    private String url;

    public static AgentTypeEnum getNameCode(String nameCode) {
        for (AgentTypeEnum item : AgentTypeEnum.values()) {
            if (item.getNameCode().equalsIgnoreCase(nameCode)) {
                return item;
            }
        }
        return AGENT;
    }
}
