package com.iwhalecloud.byai.state.domain.filebrowser.vo;

import lombok.Getter;
import lombok.Setter;

/**
 * 文件浏览器列表项VO
 *
 * @author liweto
 * @date 2026-06-04
 */
@Getter
@Setter
public class FileBrowserItemVo {

    /** 文件/文件夹名称 */
    private String name;

    /** 相对路径 */
    private String path;

    /** 是否为文件夹 */
    private boolean isDir;

    /** 文件大小（字节），文件夹为null */
    private Long size;

    /** 最后修改时间（ISO格式） */
    private String lastModified;
}
