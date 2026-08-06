package com.iwhalecloud.byai.manager.vo.skillgroup;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import lombok.Data;

@Data
public class SkillGroupVo {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    private String resourceName;

    private String resourceDesc;

    private String avatar;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long catalogId;

    private String ownerType;

    private Integer resourceStatus;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long createBy;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;

    private Long memberCount;

    private List<SkillGroupMemberVo> members = new ArrayList<>();
}
