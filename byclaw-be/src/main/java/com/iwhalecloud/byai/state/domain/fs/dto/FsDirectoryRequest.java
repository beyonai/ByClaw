package com.iwhalecloud.byai.state.domain.fs.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-06-10 17:38:38
 */
@Getter
@Setter
public class FsDirectoryRequest {

    /**
     * 文件空间类型：USER 或 RESOURCE。
     */
    private String spaceType;

    /**
     * 资源 ID；spaceType=RESOURCE 时必填，USER 空间从当前登录态确定用户。
     */
    private Long resourceId;

    /**
     * 目录路径；服务端会自动规范为以 / 开头、以 / 结尾。
     */
    private String path;

    /**
     * 删除目录时是否递归；为空时按递归删除处理。
     */
    private Boolean recursive;
}
