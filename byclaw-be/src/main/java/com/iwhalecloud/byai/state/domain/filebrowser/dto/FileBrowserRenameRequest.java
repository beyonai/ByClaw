package com.iwhalecloud.byai.state.domain.filebrowser.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class FileBrowserRenameRequest {

    private Long resourceId;

    private String sourcePath;

    private String newName;
}
