package com.iwhalecloud.byai.manager.dto.devloop;

import com.iwhalecloud.byai.manager.entity.devloop.ProjectMember;
import lombok.Getter;
import lombok.Setter;

/**
 * 项目成员列表返回 DTO。
 * <p>
 * 在成员表字段基础上补充用户工号/名称，以及绑定数字员工名称。
 */
@Getter
@Setter
public class ProjectMemberListDto extends ProjectMember {

    /** 用户工号（来自 po_users） */
    private String userCode;

    /** 用户名称（来自 po_users） */
    private String userName;

    /** 绑定的数字员工名称（来自 ss_resource.resource_name） */
    private String agentName;
}
