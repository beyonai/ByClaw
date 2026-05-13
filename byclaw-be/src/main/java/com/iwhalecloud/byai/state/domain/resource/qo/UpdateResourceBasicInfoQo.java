package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Getter;
import lombok.Setter;

/**
 * 通用资源基础信息更新入参。
 */
@Getter
@Setter
public class UpdateResourceBasicInfoQo {

    private Long resourceId;

    private String resourceName;

    private String resourceDesc;

    private Long catalogId;
}
