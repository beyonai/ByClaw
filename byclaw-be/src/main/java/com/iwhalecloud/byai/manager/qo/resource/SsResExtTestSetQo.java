package com.iwhalecloud.byai.manager.qo.resource;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.common.qo.QueryObject;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 数字员工测试集查询对象
 *
 * @author zzh
 */
@Getter
@Setter
public class SsResExtTestSetQo extends QueryObject {

    /**
     * 数字员工资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(message = "{operations.digemployee.resource.id.not.null}")
    private Long resourceId;

    /**
     * 测试集批次ID
     */
    private String batchId;

    /**
     * 处理状态（0=成功，1=处理中，2=失败）
     */
    private Integer processStatus;

    /**
     * 创建人
     */
    private String createBy;

    /**
     * 开始创建时间（格式：yyyy-MM-dd HH:mm:ss）
     */
    private String createTimeStart;

    /**
     * 结束创建时间（格式：yyyy-MM-dd HH:mm:ss）
     */
    private String createTimeEnd;

}
