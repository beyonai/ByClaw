package com.iwhalecloud.byai.state.domain.filebrowser.vo;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class FileBrowserItemVo {

    private String name;

    private String path;

    private boolean isDir;

    private Long size;

    private String lastModified;
}
