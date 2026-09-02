package com.iwhalecloud.byai.state.domain.filebrowser.vo;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * 会话内单个文件相对于首次修改前状态的变更快照。
 */
@Getter
@Setter
public class ChangedFileDiffVo {

    private Integer version;

    private String uuid;

    private String sessionId;

    private String filePath;

    private String workspace;

    private String absolutePath;

    private String changeType;

    private Boolean changed;

    private Boolean binary;

    private String contentEncoding;

    private Boolean originalExists;

    private Boolean modifiedExists;

    private Integer originalMode;

    private Integer modifiedMode;

    private Long originalSize;

    private Long modifiedSize;

    private String originalContent;

    private String modifiedContent;

    private Integer additions;

    private Integer deletions;

    private List<String> sources;
}
