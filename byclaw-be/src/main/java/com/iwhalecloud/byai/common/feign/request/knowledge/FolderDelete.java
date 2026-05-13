package com.iwhalecloud.byai.common.feign.request.knowledge;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-21 14:08:20
 * @description TODO
 */
@Getter
@Setter
public class FolderDelete {

    private Long resourceId;

    /**
     * 修改目录标识
     */
    private String directoryPath;

}
