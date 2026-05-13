package com.iwhalecloud.byai.manager.dto.openapi;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-10-23 19:23:55
 * @description TODO
 */
@Getter
@Setter
public class PublishResponseDTO {

    private Boolean success = true;

    private Long resourceId;

    private String resourceName;

    private String resourceCode;

    private Long resourceSourcePkId;

    private int errorCode;

    private String errorMessage;

}
