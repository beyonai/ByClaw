package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class DigEmployeeDto {

    private String agentType;

    private String avatar;

    private String name;

    private String resourceDesc;

    @JsonSerialize(using = LongToStringSerializer.class)
    private Long id;

    private Integer metaStatus;

    private String grantType;

    private Integer isTop;

    private String chatAvatar;

    private String resourceCode;

    private Date latestGrantTime;

    private Date topTime;

    private String terminal;

}
