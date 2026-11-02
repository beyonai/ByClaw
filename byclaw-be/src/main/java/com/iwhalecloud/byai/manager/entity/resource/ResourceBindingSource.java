package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.util.Date;
import lombok.Data;

@Data
@TableName("byai.byai_resource_binding_source")
public class ResourceBindingSource {
    @TableId(type = IdType.INPUT)
    private Long bindingSourceId;
    private Long comAcctId;
    private Long resourceId;
    private Long digitalEmployeeId;
    private String sourceType;
    private String sourceKey;
    private Long sourceUserId;
    private Long syncRevision;
    private String statusCd;
    private Long createBy;
    private Long updateBy;
    private Date createTime;
    private Date updateTime;
}
