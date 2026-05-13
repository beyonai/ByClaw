package com.iwhalecloud.byai.manager.dto.men;

import com.iwhalecloud.byai.manager.entity.men.MenTask;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;
import lombok.EqualsAndHashCode;
import java.util.List;

/**
 * 待办任务请求对象
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class MenTaskOpenApiQo extends MenTask {

    public static final String OBJ_TYPE_DIG = "DIG_EMPLOYEE";

    /** 操作类型 add或update */
    @NotBlank(groups = {
        Add.class, Mod.class
    }, message = "{mentaskopenapiqo.opertype.notempty}")
    @Pattern(groups = {
        Add.class, Mod.class
    }, regexp = "^(add|update)$", message = "{mentaskopenapiqo.opertype.notempty}")
    private String operType;

    /** 来源系统编码 */
    @NotBlank(groups = {
        Add.class, Mod.class
    }, message = "{mentaskopenapiqo.systemcode.notempty}")
    @Pattern(groups = {
        Add.class, Mod.class
    }, regexp = "^(BYAI|BOT|WHALE\\+|UIAGENT)$", message = "{mentaskopenapiqo.systemcode.invalid}")
    private String systemCode;

    /** 发送用户 */
    private String sendUserCode;

    /** 接收用户 */
    @NotNull(groups = Add.class, message = "{mentaskopenapiqo.recusercode.notempty}")
    private List<String> recUserCode;

    /**
     * 2011：bot动态解释卡片 2010:ui-agent卡片 2001:图表卡片
     */
    @NotNull(groups = Add.class, message = "{mentaskopenapiqo.contenttype.notempty}")
    private Integer contentType;

    /** 消息显示卡片 根据SDK规范结构化展示，当operType=add时必填 */
    @NotBlank(groups = Add.class, message = "{mentaskopenapiqo.contentshowcard.notempty}")
    private String contentShowCard;

    // 处理对象标识
    private String dealUserCode;

    // 接收对象类型：HUMAN、AGENT、ASSITENT、TOOL、MCP、DIG_EMPLOYEE (数字员工)，默认HUMAN
    private String recObjType;

    // 代办资源类型
    private String resourceBizType;

    /**
     * 资源id
     */
    private Long resourceId;
}