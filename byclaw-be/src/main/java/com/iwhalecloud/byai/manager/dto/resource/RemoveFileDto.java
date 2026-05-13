package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;


/**
 * @author he.duming
 * @date 2026-04-10 11:07:10
 * @description TODO
 */
@Getter
@Setter
public class RemoveFileDto {

    private Long resourceId;

    /**
     * /制度/人事/考勤制度.pdf
     */
    private String directoryPath;

}
