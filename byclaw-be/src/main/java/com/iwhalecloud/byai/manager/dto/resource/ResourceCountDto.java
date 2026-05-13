package com.iwhalecloud.byai.manager.dto.resource;


import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class ResourceCountDto {
    private Long employeeId;

    private String resourceBizType;

    private Long count;
}
