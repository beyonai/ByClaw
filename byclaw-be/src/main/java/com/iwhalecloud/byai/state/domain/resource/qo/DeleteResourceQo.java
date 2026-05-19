package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Getter;
import lombok.Setter;

/**
 * 资源删除入参。
 *
 * @author qin.guoquan
 * @date 2026-04-26 13:45:00
 */
@Getter
@Setter
public class DeleteResourceQo {

    private Long resourceId;

    private String resourceCode;

    private String ownerType;

    private Boolean forceDelete;
}
