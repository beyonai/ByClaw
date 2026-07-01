package com.iwhalecloud.byai.common.constants.resource;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * 资源业务类型枚举
 */
@RequiredArgsConstructor
@Getter
public enum ResourceBizType {

    DIG_EMPLOYEE("DIG_EMPLOYEE", "数字员工"),
    AGENT("AGENT", "智能体"),
    KG_DOC("KG_DOC", "文档知识库"),
    KG_DB("KG_DB", "数据知识库"),
    KG_TERM("KG_TERM", "术语知识库"),
    KG_QA("KG_QA", "问答知识库"),
    SKILL("SKILL", "技能"),
    TOOLKIT("TOOLKIT", "工具集"),
    TOOL("TOOL", "工具"),
    MCP("MCP", "MCP服务"),
    VIEW("VIEW", "视图"),
    ACTION("ACTION", "动作"),
    OBJECT("OBJECT", "对象"),
    DB_DATASET("DB_DATASET", "数据集"),
    MCP_TOOL("MCP_TOOL", "MCP工具");

    private final String code;
    private final String desc;

    public static boolean isValid(String code) {
        for (ResourceBizType type : values()) {
            if (type.code.equals(code)) {
                return true;
            }
        }
        return false;
    }


    public static List<String> getSupportedTypes() {
        List<String> types = new ArrayList<>();
        for (ResourceBizType type : values()) {
            types.add(type.code);
        }
        return types;
    }

    public static ResourceBizType getByCode(String code) {
        for (ResourceBizType type : values()) {
            if (type.code.equals(code)) {
                return type;
            }
        }
        return null;
    }

    /**
     * 判断是否支持"我创建的"查询
     * 只有DOC和DB类型支持
     */
    public boolean supportMyCreated() {
        return getSupportedTypes().contains(this.code);

    }
}
