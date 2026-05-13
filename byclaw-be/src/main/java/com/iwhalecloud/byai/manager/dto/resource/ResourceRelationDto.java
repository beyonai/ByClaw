package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ResourceRelationDto {

    private String resourceName;

    private String resourceBizType;

    private String resourceDesc;

    private String resourceType;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceSourcePkId;

}
