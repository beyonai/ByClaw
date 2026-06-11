package com.iwhalecloud.byai.state.domain.fs.vo;

import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-06-10 17:38:38
 */
@Getter
@Setter
public class FsDirectoryRenameFailedItemVo {

    /**
     * 失败的源对象路径。
     */
    private String sourcePath;

    /**
     * 复制阶段对应的目标对象路径；删除阶段失败时为空。
     */
    private String targetPath;

    /**
     * 失败阶段：COPY 或 DELETE。
     */
    private String stage;

    /**
     * 失败原因，透传底层异常消息便于排查。
     */
    private String errorMessage;
}
