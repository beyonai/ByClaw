package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-09-07 10:43:19
 * @description TODO
 */
@Getter
@Setter
public class ResourceDetailDto {

    private Long resourceRelDetailId;

    private Long resourceId;

    private Long relResourceId;

    private Long resourceSourcePkId;
}
