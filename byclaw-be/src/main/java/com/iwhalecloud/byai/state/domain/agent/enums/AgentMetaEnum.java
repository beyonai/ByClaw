package com.iwhalecloud.byai.state.domain.agent.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum AgentMetaEnum {

    /**
     * 智能体
     */
    AGENT("AGENT", "智能体"),

    /**
     * 数字员工
     */
    DIG_EMPLOYEE("DIG_EMPLOYEE", "数字员工"),

    /**
     * 目录
     */
    CATALOGUE("CATALOGUE", "目录"),

    /**
     * 员工助手
     */
    HUMAN_ASSISTANT("HUMAN_ASSISTANT", "员工助手"),

    /**
     * 文档知识库
     */
    KG_DOC("KG_DOC", "文档知识库"),

    /**
     * 文档知识库文件夹
     */
    KG_DOC_FOLDER("KG_DOC_FOLDER", "文档知识库文件夹"),

    /**
     * 文档知识库文件
     */
    KG_DOC_FILE("KG_DOC_FILE", "文档知识库文件"),

    /**
     * 问答知识库
     */
    KG_QA("KG_QA", "问答知识库"),

    /**
     * 问答知识库文件夹
     */
    KG_QA_FOLDER("KG_QA_FOLDER", "问答知识库文件夹"),

    /**
     * 问答知识库文件
     */
    KG_QA_FILE("KG_QA_FILE", "问答知识库文件"),

    /**
     * 术语知识库
     */
    KG_TERM("KG_TERM", "术语知识库"),

    /**
     * 术语知识库文件夹
     */
    KG_TERM_FOLDER("KG_TERM_FOLDER", "术语知识库文件夹"),

    /**
     * 术语知识库文件
     */
    KG_TERM_FILE("KG_TERM_FILE", "术语知识库文件"),

    /**
     * 数据库
     */
    KG_DB("KG_DB", "数据库"),

    /**
     * 数据库文件夹
     */
    KG_DB_FOLDER("KG_DB_FOLDER", "数据库文件夹"),

    /**
     * 数据库文件
     */
    KG_DB_FILE("KG_DB_FILE", "数据库文件"),

    /**
     * 工具集
     */
    TOOLKIT("TOOLKIT", "工具集"),

    /**
     * MCP服务
     */
    MCP("MCP", "MCP服务"),

    /**
     * MCP工具
     */
    MCP_TOOL("MCP_TOOL", "MCP工具"),

    /**
     * 工具
     */
    TOOL("TOOL", "工具"),

    /**
     * 员工
     */
    HUMAN("HUMAN", "员工"),

    /**
     * 视图
     */
    VIEW("VIEW", "视图"),


    /**
     * 对象
     */
    OBJECT("OBJECT", "对象");

    /**
     * 枚举代码
     */
    String code;

    /**
     * 枚举名称
     */
    String name;

}
