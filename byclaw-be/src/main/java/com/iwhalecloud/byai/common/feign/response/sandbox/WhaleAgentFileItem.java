package com.iwhalecloud.byai.common.feign.response.sandbox;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class WhaleAgentFileItem {

    private Boolean directory;

    private String filePath;

    private String lastModified;

    private String name;

    private Long size;
}
