package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Setter
@Getter
public class PermissionDto {
    private List<Long> resourceIds;

    private String resourceType;

    private List<String> grantTypes;
}
