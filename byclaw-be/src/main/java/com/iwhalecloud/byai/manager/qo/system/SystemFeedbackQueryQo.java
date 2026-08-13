package com.iwhalecloud.byai.manager.qo.system;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;

/**
 * 系统反馈管理查询条件。
 *
 * @author qin.guoquan
 * @date 2026-07-27 15:37:18
 */
@Getter
@Setter
public class SystemFeedbackQueryQo extends QueryObject {

    /**
     * 反馈类型。
     */
    private String feedbackType;

    /**
     * 反馈状态。
     */
    private String status;

    /**
     * 标题或描述关键词。
     */
    private String keyword;

    /**
     * 反馈标题。
     */
    private String title;

    /**
     * 反馈描述，对应系统反馈表 content 字段。
     */
    private String content;
}
