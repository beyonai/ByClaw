package com.iwhalecloud.byai.common.constants.devloop;

/**
 * 软删除标记。
 */
public final class DeleteFlag {

    private DeleteFlag() {
    }

    /** 未删除 */
    public static final String NORMAL = "0";

    /** 已删除 */
    public static final String DELETED = "1";
}
