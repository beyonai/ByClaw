package com.iwhalecloud.byai.manager.dto.digitemploy;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 数字员工组成员配置及回显信息。
 *
 * @author qin.guoquan
 * @date 2026-08-10 17:38:38
 */
@Getter
@Setter
public class EmployeeGroupMemberDTO {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    private String resourceCode;

    private String name;

    private String description;

    private String teamRole;

    private Integer sortOrder;

    private String createType;

    private String integrationType;

    private String agentType;

    private String workerAgentType;
}
