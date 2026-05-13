package com.iwhalecloud.byai.manager.dto.digitemploy;

import lombok.Data;

import java.util.List;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/12/12 10:43
 */
@Data
public class RelResourceInfo {
    /**
     * 关联资源ID
     */
    private String relId;

     /**
      * 可用的资源ID列表
      */
    private List<String> activeResourceIds;
}
