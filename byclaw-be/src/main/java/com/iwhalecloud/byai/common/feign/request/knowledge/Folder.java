package com.iwhalecloud.byai.common.feign.request.knowledge;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-21 14:00:53
 * @description TODO
 */
@Getter
@Setter
public class Folder {

    /**
     * 知识库标识
     */
    private Long resourceId;

    private String directoryName;

    private String directoryPath;

    private String directoryDescription;

}
