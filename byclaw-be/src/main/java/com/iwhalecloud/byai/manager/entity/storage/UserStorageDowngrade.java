package com.iwhalecloud.byai.manager.entity.storage;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_user_storage_downgrade")
public class UserStorageDowngrade {

    @TableId(value = "downgrade_id", type = IdType.INPUT)
    private Long downgradeId;

    private String requestId;

    private Long userId;

    private Long grantId;

    /** 新流程支持一次选择多条具体权益；旧记录为空时回退到 grantId。 */
    private String grantIds;

    private Long packageId;

    /** 申请时的增值包名称快照，避免配置改名后审计记录失真。 */
    private String packageNames;

    /** 本次新增或取消的合计容量。 */
    private Long changeBytes;

    private String requestSource;

    private String requestType;

    private String downgradeStatus;

    private String grantSource;

    private Long beforeQuotaBytes;

    private Long targetQuotaBytes;

    private Long usedBytesSnapshot;

    private Long reservedBytesSnapshot;

    private Long overageBytes;

    private String reason;

    private String reviewRemark;

    private Date graceDeadline;

    private Long relatedRecycleId;

    private Long requestedBy;

    private Long reviewedBy;

    private Date requestedTime;

    private Date reviewedTime;

    private Date completedTime;

    private String errorMessage;

    private Long version;
}
