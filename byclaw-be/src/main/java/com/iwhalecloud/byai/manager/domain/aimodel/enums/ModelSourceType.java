package com.iwhalecloud.byai.manager.domain.aimodel.enums;

/**
 * 模型来源类型（byai_aimodel.source_type）。
 */
public final class ModelSourceType {

    private ModelSourceType() {
    }

    /** BYAI 系统分配 */
    public static final String BYAI = "BYAI";

    /** TokenSaver 系统分配 */
    public static final String TOKEN_SAVER = "TOKEN_SAVER";
}
