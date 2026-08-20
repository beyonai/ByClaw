package com.iwhalecloud.byai.manager.dto.devloop;

import com.iwhalecloud.byai.manager.entity.devloop.ProjectMember;
import lombok.Getter;
import lombok.Setter;

/**
 * 项目成员列表返回 DTO。
 * <p>
 * 在成员表字段基础上补充用户账号/工号/名称，以及绑定数字员工名称。
 */
@Getter
@Setter
public class ProjectMemberListDto extends ProjectMember {

    /** 用户账号（来自 po_users.user_code），系统内部登录标识，不是工号 */
    private String userCode;

    /** 用户名称（来自 po_users） */
    private String userName;

    /** 绑定的数字员工名称（来自 ss_resource.resource_name） */
    private String agentName;

    /**
     * 工号（来自 po_users.user_number），与钉钉的 jobNumber 是同一个值。
     * <p>
     * 外部连接器精确匹配联系人的首选：按姓名模糊搜会重名也会搜不到，工号唯一且不是敏感个人信息。
     */
    private String userNumber;

    /**
     * 手机号（来自 po_users.phone）。
     * <p>
     * 工号缺失时的兜底精确匹配项。属于敏感个人信息，调用方须显式索取。
     */
    private String phone;
}
