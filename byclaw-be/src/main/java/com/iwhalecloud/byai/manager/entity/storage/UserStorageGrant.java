package com.iwhalecloud.byai.manager.entity.storage;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_user_storage_grant")
public class UserStorageGrant {

    @TableId(value = "grant_id", type = IdType.INPUT)
    private Long grantId;

    private Long userId;

    private Long packageId;

    private Long grantedBytes;

    private String grantStatus;

    private String grantSource;

    private Long grantedBy;

    private Date grantedTime;

    private Long revokedBy;

    private Date revokedTime;

    private String remark;
}
