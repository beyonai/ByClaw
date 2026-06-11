package com.iwhalecloud.byai.state.domain.fs.vo;

import java.util.ArrayList;
import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-06-10 17:38:38
 */
@Getter
@Setter
public class FsDirectoryRenameResultVo {

    /**
     * 文件空间类型：USER 或 RESOURCE。
     */
    private String spaceType;

    /**
     * 资源 ID；USER 空间为空。
     */
    private Long resourceId;

    /**
     * 原目录路径。
     */
    private String oldPath;

    /**
     * 新目录路径。
     */
    private String newPath;

    /**
     * 源目录下列出的对象总数。
     */
    private Integer total;

    /**
     * 已复制成功的对象数量。
     */
    private Integer copied;

    /**
     * 已删除成功的源对象数量，仅统计复制成功后进入删除阶段的对象。
     */
    private Integer deleted;

    /**
     * 复制或删除失败的对象数量。
     */
    private Integer failed;

    /**
     * 逐对象失败明细，便于调用方对部分失败进行补偿。
     */
    private List<FsDirectoryRenameFailedItemVo> failedItems = new ArrayList<>();
}
