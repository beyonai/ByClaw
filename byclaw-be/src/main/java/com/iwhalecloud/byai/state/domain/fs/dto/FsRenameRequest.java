package com.iwhalecloud.byai.state.domain.fs.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-06-10 17:38:38
 */
@Getter
@Setter
public class FsRenameRequest {

    /**
     * 文件空间类型：USER 或 RESOURCE。
     */
    private String spaceType;

    /**
     * 资源 ID；spaceType=RESOURCE 时必填。
     */
    private Long resourceId;

    /**
     * 原文件或原目录路径；目录重命名时会规范为以 / 结尾。
     */
    private String oldPath;

    /**
     * 新文件或新目录路径；目录重命名时会规范为以 / 结尾。
     */
    private String newPath;

    /**
     * 目标已存在时是否允许覆盖；为空或 false 时会拒绝覆盖。
     */
    private Boolean overwrite;
}
