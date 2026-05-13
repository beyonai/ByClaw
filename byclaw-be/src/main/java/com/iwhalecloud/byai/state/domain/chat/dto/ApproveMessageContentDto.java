package com.iwhalecloud.byai.state.domain.chat.dto;

import com.iwhalecloud.byai.state.common.enums.ApproveStatusEnum;
import lombok.Data;

import java.util.List;

/**
 * @author zht
 * @version 1.0
 * @date 2025/6/23
 */
@Data
public class ApproveMessageContentDto {

    /**
     * 审核人
     */
    private Long approveUserId;


    /**
     * 申请人
     */
    private Long applyUserId;

    /**
     * 智能体id
     */
    private Long agentId;

    /**
     * 表单内容
     */
    private List<MessageFormContentDto> rule;

    /**
     * 标题
     */
    private String title;
    /**
     * 审核状态
     */
    private ApproveStatusEnum state; // PENDING, HANDLED

}
