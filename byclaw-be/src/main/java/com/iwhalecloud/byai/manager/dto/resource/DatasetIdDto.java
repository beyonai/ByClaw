package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-03-30 16:36:48
 * @description TODO
 */
@Getter
@Setter
public class DatasetIdDto {

    private Long resourceId;

    private String path = "/";
}
