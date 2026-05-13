package com.iwhalecloud.byai.manager.qo.resource;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-08-08 20:51:46
 * @description TODO
 */
@Getter
@Setter
public class ResourceIdQo {

    private List<Long> resourceIds;
    /**
     * 资源状态
     */
    private Integer resourceStatus;
}
