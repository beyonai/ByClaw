package com.iwhalecloud.byai.common.constants.errorcode;

/**
 * @author he.duming
 * @date 2025-04-14 15:45:24
 * @description 异常编码定义
 */
public final class CommonErrorCode {

    private CommonErrorCode() {
    }

    /**
     * 参数校验异常,对应400
     */
    public static final int ERROR_CODE_50400 = 50400;

    /**
     * 通用操作异常
     */
    public static final int ERROR_CODE_50500 = 50500;

    /**
     * 资源正在审核中，无法再次发布!
     */
    public static final int RESOURCE_ERROR_CODE_1 = 1;

    /**
     * 资源类型其他错误
     */
    public static final int RESOURCE_ERROR_CODE_0 = 0;

    // ---------- 模型管理（与接口文档建议一致） ----------
    /** 参数校验失败 */
    public static final int AIMODEL_ERROR_CODE_40001 = 40001;
    /** 模型名称已存在（唯一性校验） */
    public static final int AIMODEL_ERROR_CODE_40002 = 40002;
    /** 模型不存在 */
    public static final int AIMODEL_ERROR_CODE_40004 = 40004;
    /** 服务端异常 */
    public static final int AIMODEL_ERROR_CODE_50000 = 50000;
    /** 调试执行失败 */
    public static final int AIMODEL_ERROR_CODE_50010 = 50010;

}
