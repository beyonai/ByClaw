package com.iwhalecloud.byai.manager.entity.storage;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_user_storage_recycle")
public class UserStorageRecycle {

    @TableId(value = "recycle_id", type = IdType.INPUT)
    private Long recycleId;

    private Long userId;

    private String sourceBucket;

    private String archiveBucket;

    private String archivePath;

    private Long archiveBytes;

    private String recycleStatus;

    private Date retentionUntil;

    private String requestId;

    private Long operatorId;

    private Date startedTime;

    private Date finishedTime;

    private String errorMessage;
}
