package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Getter;
import lombok.Setter;

/**
 * 资源图片生成入参。
 * @author qin.guoquan
 * @date 2026-06-21 20:38:38
 */
@Getter
@Setter
public class GenerateResourceImageQo {

    private String resourceName;

    private String resourceDesc;
}
