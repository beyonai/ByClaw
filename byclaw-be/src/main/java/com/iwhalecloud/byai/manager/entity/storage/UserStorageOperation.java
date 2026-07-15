package com.iwhalecloud.byai.manager.entity.storage;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_user_storage_operation")
public class UserStorageOperation {

    @TableId(value = "operation_id", type = IdType.INPUT)
    private Long operationId;

    private String requestId;

    private Long userId;

    private String operationType;

    private String operationStatus;

    private Long operatorId;

    private Long beforeQuota;

    private Long afterQuota;

    private Long beforeUsed;

    private Long afterUsed;

    private Long relatedRecycleId;

    private String errorMessage;

    private Date createTime;

    private Date finishTime;
}
