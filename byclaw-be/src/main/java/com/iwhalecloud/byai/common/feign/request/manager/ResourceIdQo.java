package com.iwhalecloud.byai.common.feign.request.manager;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ResourceIdQo {

    private List<Long> resourceIds;

    /**
     * 资源状态
     */
    private Integer resourceStatus;
}
