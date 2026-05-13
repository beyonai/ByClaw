package com.iwhalecloud.byai.state.common.dto;

import java.util.List;


import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 批量取消订阅审批请求
 */
@Data
public class BatchUnsubscribeApprovalRequest {

    /**
     * 审批申请列表
     */
    @NotEmpty(message = "{batchunsubscribeapprovalrequest.approvalitems.notempty}")
    @Valid
    private List<UnsubscribeApprovalItem> approvalItems;

    private String type;

    /**
     * 单个取消订阅审批项
     */
    @Data
    public static class UnsubscribeApprovalItem {

        /**
         * 资源对象ID
         */
        @NotNull(message = "{batchunsubscribeapprovalrequest.objid.notempty}")
        private Long objId;

        /**
         * 申请理由
         */
        private String reason;

        /**
         * 审批人ID
         */
        @NotNull(message = "{batchunsubscribeapprovalrequest.approveuserid.notempty}")
        private Long approveUserId;

    }




}