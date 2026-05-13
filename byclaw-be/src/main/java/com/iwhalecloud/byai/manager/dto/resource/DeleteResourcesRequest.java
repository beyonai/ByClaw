package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 删除资源请求DTO
 */
@Getter
@Setter
public class DeleteResourcesRequest {

    @NotEmpty(message = "{deleteresourcesrequest.resourceids.notempty}")
    private List<Long> resourceIds;
}
