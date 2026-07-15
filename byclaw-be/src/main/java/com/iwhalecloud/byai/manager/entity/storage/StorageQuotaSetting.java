package com.iwhalecloud.byai.manager.entity.storage;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_storage_quota_setting")
public class StorageQuotaSetting {

    @TableId(value = "setting_id", type = IdType.INPUT)
    private Long settingId;

    private Long defaultQuotaBytes;

    private Integer warningPercent;

    private Integer recycleRetentionDays;

    private Integer downgradeGraceDays;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;
}
