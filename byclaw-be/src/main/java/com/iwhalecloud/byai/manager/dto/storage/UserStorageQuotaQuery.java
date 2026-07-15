package com.iwhalecloud.byai.manager.dto.storage;

import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UserStorageQuotaQuery {

    private Integer pageNum = 1;

    private Integer pageSize = 20;

    /** 用户编码模糊查询。 */
    private String userCode;

    /** 兼容旧版用户编码/桶名称综合查询参数。 */
    private String keyword;

    private String usageStatus;

    private Long packageId;

    /** 仅查询仍在有效期内且可恢复的临时回收站记录所属用户。 */
    private Boolean hasValidRecycle;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date recycleCreatedStart;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date recycleCreatedEnd;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date recycleExpiredStart;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date recycleExpiredEnd;

    /** usedBytes, usageStatus, recycleCreatedTime, recycleExpiredTime。 */
    private String sortField;

    /** asc 或 desc。 */
    private String sortOrder;
}
