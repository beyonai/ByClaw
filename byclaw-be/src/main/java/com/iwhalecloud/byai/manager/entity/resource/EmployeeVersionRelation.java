package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

/** 从不可变配置快照派生的依赖索引，不能单独编辑。 */
@Data
@TableName("byai.ss_resource_version_relation")
public class EmployeeVersionRelation {
    @TableId
    private Long relationId;
    private Long tenantId;
    private Long resourceId;
    private Long versionId;
    private String relationType;
    private Long targetResourceId;
    private String targetCode;
    private Long targetVersionId;
    private String bindingMode;
    private Integer sortOrder;
    private String relationConfig;
}
