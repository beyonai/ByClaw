package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-04-16 19:56:28
 * @description TODO
 */
@Getter
@Setter
public class DatasetBuild {

    private Long resourceId;

    /**
     * /制度/人事/请假制度.pdf
     */
    private String directoryPath;
}
