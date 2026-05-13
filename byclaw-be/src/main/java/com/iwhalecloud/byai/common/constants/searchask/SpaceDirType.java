package com.iwhalecloud.byai.common.constants.searchask;

/**
 * @author he.duming
 * @date 2026-03-04 09:26:50
 * @description 空间目录类型
 */
public final class SpaceDirType {

    private SpaceDirType() {
    }

    /** 目录类型：用户导入 */
    public static final String DIR_TYPE_IMPORT = "IMPORT";

    /** 目录类型：联网检索 */
    public static final String DIR_TYPE_WEB_SEARCH = "WEB_SEARCH";

    /** 目录类型：个人知识库 */
    public static final String DIR_TYPE_PERSONAL_KB = "PERSONAL_KB";

    /** 目录类型：企业知识库 */
    public static final String DIR_TYPE_ENTERPRISE_KB = "ENTERPRISE_KB";

    /** 目录类型：钉钉聊天 */
    public static final String DIR_TYPE_DING_CHAT = "DING_CHAT";

    /** 目录类型：收藏夹 */
    public static final String DIR_TYPE_COLLECT = "COLLECT";
}
