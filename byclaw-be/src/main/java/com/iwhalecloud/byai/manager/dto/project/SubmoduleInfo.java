package com.iwhalecloud.byai.manager.dto.project;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 子模块信息
 *
 * 用于配置集成项目初始化时需要添加的 Git 子模块
 */
@Data
public class SubmoduleInfo {

    /**
     * 子模块 Git 仓库 URL
     *
     * 例如: https://github.com/org/repo.git
     */
    @NotBlank(message = "{submoduleinfo.url.notblank}")
    private String url;

    /**
     * 子模块在集成项目中的相对路径
     *
     * 例如: modules/repo1
     */
    @NotBlank(message = "{submoduleinfo.path.notblank}")
    private String path;

    /**
     * 子模块分支名称（可选）
     *
     * 如果不提供，则使用仓库的默认分支
     */
    private String branch;
}
