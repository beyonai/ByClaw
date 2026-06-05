package com.iwhalecloud.byai.state.domain.filebrowser.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class FileBrowserListRequest {

    private Long resourceId;

    private String path;
}
