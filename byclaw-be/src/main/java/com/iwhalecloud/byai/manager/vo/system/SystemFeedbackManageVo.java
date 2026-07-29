package com.iwhalecloud.byai.manager.vo.system;

import com.iwhalecloud.byai.manager.entity.system.SystemFeedback;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * 系统反馈管理列表及详情信息。
 *
 * @author qin.guoquan
 * @date 2026-07-27 15:37:18
 */
@Getter
@Setter
public class SystemFeedbackManageVo extends SystemFeedback {

    /**
     * 反馈提交人名称。
     */
    private String userName;

    /**
     * 有效附件数量。
     */
    private Integer attachmentCount;

    /**
     * 详情中的附件列表。
     */
    private List<SystemFeedbackAttachmentVo> attachments = new ArrayList<>();
}
