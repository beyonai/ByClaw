package com.iwhalecloud.byai.state.domain.fs.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-06-10 17:38:38
 */
@Getter
@Setter
public class FsFileDeleteRequest {

    /**
     * 文件空间类型：USER 或 RESOURCE。
     */
    private String spaceType;

    /**
     * 资源 ID；spaceType=RESOURCE 时必填。
     */
    private Long resourceId;

    /**
     * 待删除文件路径，不能以 / 结尾。
     */
    private String path;
}
