package com.iwhalecloud.byai.manager.dto.digitemploy;

import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import lombok.Data;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/12/12 14:14
 */
@Data
public class SsResourceDTO extends SsResource {

    /**
     * 关联资源信息
     */
    private String relResourceInfo;

    /**
     * 关联可用资源数量
     */
    private Integer activeResourceNum;


    private Long relDetailId;

    private Long relResourceId;
}
