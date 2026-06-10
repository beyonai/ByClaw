package com.iwhalecloud.byai.state.domain.fs.vo;

import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-06-10 17:38:38
 */
@Getter
@Setter
public class FsRenameResultVo {

    /**
     * 文件空间类型：USER 或 RESOURCE。
     */
    private String spaceType;

    /**
     * 资源 ID；USER 空间为空。
     */
    private Long resourceId;

    /**
     * 原文件路径。
     */
    private String oldPath;

    /**
     * 新文件路径。
     */
    private String newPath;

    /**
     * 是否完成移动。
     */
    private Boolean moved;

    /**
     * 是否按 overwrite=true 覆盖目标路径。
     */
    private Boolean overwritten;
}
