package com.iwhalecloud.byai.manager.qo.devloop;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;
import org.apache.commons.lang3.StringUtils;

/**
 * 项目会话查询对象
 */
@Getter
@Setter
public class ProjectSessionQo extends QueryObject {

    /** 按数字员工名称、描述查找其关联会话。 */
    public static final String SEARCH_MODE_DIGITAL_EMPLOYEE = "DIGITAL_EMPLOYEE";

    /** 按会话内可见消息正文查找会话。 */
    public static final String SEARCH_MODE_CHAT_CONTENT = "CHAT_CONTENT";

    /** 项目ID */
    private Long projectId;

    /** 创建人 */
    private Long createBy;

    /**
     * 会话搜索方式；未传或非法值保持旧的会话标题、摘要搜索行为，保证既有调用兼容。
     */
    private String searchMode;

    /**
     * 规范化搜索方式与关键字，避免前端大小写差异或空白关键字意外触发高级搜索。
     */
    public void normalizeSearchCondition() {
        setKeyword(StringUtils.trimToNull(getKeyword()));
        searchMode = StringUtils.upperCase(StringUtils.trimToNull(searchMode));
        if (!SEARCH_MODE_DIGITAL_EMPLOYEE.equals(searchMode) && !SEARCH_MODE_CHAT_CONTENT.equals(searchMode)) {
            searchMode = null;
        }
    }

    /** MyBatis 条件：仅在有关键字时按数字员工搜索。 */
    public boolean isDigitalEmployeeSearch() {
        return StringUtils.isNotBlank(getKeyword()) && SEARCH_MODE_DIGITAL_EMPLOYEE.equals(searchMode);
    }

    /** MyBatis 条件：仅在有关键字时按聊天内容搜索。 */
    public boolean isChatContentSearch() {
        return StringUtils.isNotBlank(getKeyword()) && SEARCH_MODE_CHAT_CONTENT.equals(searchMode);
    }

    /**
     * 新搜索方式使用字面量包含匹配，转义 LIKE 的通配符，避免用户输入 % 或 _ 时扩大匹配范围。
     */
    public String getKeywordLike() {
        if (getKeyword() == null) {
            return null;
        }
        return getKeyword().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
