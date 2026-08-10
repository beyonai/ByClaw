package com.iwhalecloud.byai.manager.vo.skillgroup;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.time.LocalDateTime;
import lombok.Data;

@Data
public class SkillGroupMemberVo {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    private String resourceCode;

    private String resourceName;

    private String resourceDesc;

    private String avatar;

    private Integer resourceStatus;

    private String ownerType;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long createBy;

    private String skillType;

    private String sourceType;

    private String version;

    private String skillUrl;

    private String skillPackageFormat;

    private String skillOriginalFilename;

    private Long skillPackageSize;

    private String skillPackageHash;

    private String targetContent;

    private String syncStatus;

    private String syncError;

    private LocalDateTime lastSyncTime;
}
