package com.iwhalecloud.byai.state.domain.fs.enums;

import org.apache.commons.lang3.StringUtils;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

/**
 * FS 操作目标空间。
 * USER 对应当前登录用户文件系统；RESOURCE 对应平台资源文件系统。
 *
 * @author qin.guoquan
 * @date 2026-06-10 17:38:38
 */
public enum FsSpaceType {

    /**
     * 当前登录用户私有文件空间。
     */
    USER,

    /**
     * 平台资源文件空间，必须结合 resourceId 做权限校验。
     */
    RESOURCE;

    public static FsSpaceType of(String value) {
        for (FsSpaceType type : values()) {
            if (StringUtils.equalsIgnoreCase(type.name(), value)) {
                return type;
            }
        }
        throw new IllegalArgumentException(I18nUtil.get("byclaw.fs.space.type.invalid"));
    }
}
