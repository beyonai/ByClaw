package com.iwhalecloud.byai.manager.dto.resource;

import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-04-02 20:15:16
 * @description TODO
 */
@Getter
@Setter
public class DatasetDto extends SsResource {

    /**
     * 类型：本地知识库为dataset，第三方知识库为external
     */
    private String type;

}
