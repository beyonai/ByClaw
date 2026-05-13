package com.iwhalecloud.byai.common.feign.request.knowledge;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-08-08 10:32:50
 * @description TODO
 */
@Getter
@Setter
public class OpenFileTag {

    private Long fileId;

    private String tags;
}
