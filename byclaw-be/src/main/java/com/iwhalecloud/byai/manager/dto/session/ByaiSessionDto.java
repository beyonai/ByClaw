package com.iwhalecloud.byai.manager.dto.session;

import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class ByaiSessionDto extends ByaiSession {

    /**
     * 项目名称
     */
    private String projectName;

    /**
     * 图标
     */
    private String avatar;

    /**
     * 扩展属性
     */
    private List<ByaiSessionExt> sessionExts;

    /**
     * 当前列表项命中的高级搜索方式：DIGITAL_EMPLOYEE 或 CHAT_CONTENT。
     */
    private String matchType;

    /**
     * 聊天内容搜索命中的消息片段，仅在 CHAT_CONTENT 模式返回。
     */
    private String matchText;

    /**
     * 数字员工搜索命中的员工 ID，仅在 DIGITAL_EMPLOYEE 模式返回。
     */
    private Long matchedEmployeeId;

    /**
     * 数字员工搜索命中的员工名称，仅在 DIGITAL_EMPLOYEE 模式返回。
     */
    private String matchedEmployeeName;

    /**
     * 数字员工搜索实际命中的字段：NAME 或 DESCRIPTION，仅在 DIGITAL_EMPLOYEE 模式返回。
     */
    private String matchedEmployeeMatchField;

    /**
     * 数字员工搜索实际命中的名称或描述片段，仅在 DIGITAL_EMPLOYEE 模式返回。
     */
    private String matchedEmployeeMatchText;

}
