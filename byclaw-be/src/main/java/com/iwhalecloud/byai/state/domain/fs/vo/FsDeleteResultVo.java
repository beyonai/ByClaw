package com.iwhalecloud.byai.state.domain.fs.vo;

import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-06-10 17:38:38
 */
@Getter
@Setter
public class FsDeleteResultVo {

    /**
     * 文件空间类型：USER 或 RESOURCE。
     */
    private String spaceType;

    /**
     * 资源 ID；USER 空间为空。
     */
    private Long resourceId;

    /**
     * 本次操作的文件或目录路径。
     */
    private String path;

    /**
     * 删除操作是否成功。
     */
    private Boolean deleted;

    /**
     * 创建目录操作是否成功。
     */
    private Boolean created;

    /**
     * 删除目录时是否递归。
     */
    private Boolean recursive;

    /**
     * 删除影响的对象数量；目录删除时为删除前列出的对象数量。
     */
    private Integer deletedCount;
}
