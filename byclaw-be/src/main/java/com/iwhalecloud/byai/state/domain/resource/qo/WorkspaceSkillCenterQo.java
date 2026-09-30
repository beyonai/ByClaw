package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Data;

/** 当前员工目录技能同步；用户身份与目标归属均由服务端解析。 */
@Data
public class WorkspaceSkillCenterQo {
    private Long resourceId;
    private String skillPath;

    /** 已安装技能的资源 ID；服务端验证员工绑定并解析目录，不信任客户端路径。 */
    private Long targetResourceId;

    /** 预检查版本，避免确认期间目录或资源中心技能变化后覆盖新内容。 */
    private String revision;
}
