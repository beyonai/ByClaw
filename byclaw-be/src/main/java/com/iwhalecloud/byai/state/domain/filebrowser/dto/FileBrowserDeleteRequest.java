package com.iwhalecloud.byai.state.domain.filebrowser.dto;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class FileBrowserDeleteRequest {

    private Long resourceId;

    private List<String> paths;
}
