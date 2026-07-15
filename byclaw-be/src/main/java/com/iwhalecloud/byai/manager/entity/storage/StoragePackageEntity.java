package com.iwhalecloud.byai.manager.entity.storage;

import java.math.BigDecimal;
import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_storage_package")
public class StoragePackageEntity {

    @TableId(value = "package_id", type = IdType.INPUT)
    private Long packageId;

    private String packageCode;

    private String packageName;

    private Long addonBytes;

    private BigDecimal price;

    private String status;

    private Integer sortNo;

    private String remark;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    /** 当前持有该增值包生效权益的去重用户数。 */
    @TableField(exist = false)
    private Long usedUserCount;
}
