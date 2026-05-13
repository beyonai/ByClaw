package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-04-27 17:24:56
 * @description TODO
 */
@Getter
@Setter
public class DirOrFile {

    private String knCode;

    private String name;

    private String type;

    private Long size;
}
