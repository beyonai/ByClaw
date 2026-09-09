package com.iwhalecloud.byai.manager.vo.auth;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 审核中心聚合返回的数字员工使用申请。 */
@Getter
@Setter
public class DigitalEmployeeUseApplyAuditVo extends ResourceUseApplyItemVo {

    /** 审核通过或驳回的处理时间，仅历史审核记录有值。 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date auditTime;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    private String resourceName;

    private String resourceBizType;

    private String agentType;

    private String avatar;
}
