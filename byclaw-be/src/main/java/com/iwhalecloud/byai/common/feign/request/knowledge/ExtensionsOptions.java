package com.iwhalecloud.byai.common.feign.request.knowledge;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-12-29 09:23:34
 * @description TODO
 */
@Getter
@Setter
public class ExtensionsOptions {

    /**
     * 是否按页码排序 true：切片按照页码升序排序 false：默认按照匹配得分排序
     */
    @JsonProperty("sortByPageNum")
    private Boolean sortByPageNum = false;
}
