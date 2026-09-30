package com.iwhalecloud.byai.manager.vo.auth;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/** 个人技能当前发布副本的摘要；沿用资源审核状态，不创建另一套申请状态。 */
@Getter
@Setter
public class SkillPublicationVo {
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;
    private String resourceName;
    private Integer resourceStatus;
}
