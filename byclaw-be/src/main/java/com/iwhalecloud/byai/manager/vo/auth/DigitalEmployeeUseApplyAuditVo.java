package com.iwhalecloud.byai.manager.vo.auth;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 审核中心聚合返回的资源使用申请；保留原类名兼容数字员工审核调用方。 */
@Getter
@Setter
public class DigitalEmployeeUseApplyAuditVo extends ResourceUseApplyItemVo {

    /** 审核通过或驳回的处理时间，仅历史审核记录有值。 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date auditTime;

    /** 处理审核的用户标识，来源于权限记录的最后修改人。 */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long auditUserId;

    /** 处理审核的用户名称。 */
    private String auditUserName;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    private String resourceName;

    private String resourceBizType;

    private String agentType;

    private String avatar;
}
