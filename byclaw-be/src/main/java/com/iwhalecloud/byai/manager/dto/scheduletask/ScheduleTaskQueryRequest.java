package com.iwhalecloud.byai.manager.dto.scheduletask;

import com.iwhalecloud.byai.manager.qo.scheduletask.ScheduleTaskQo;
import lombok.Getter;
import lombok.Setter;

/**
 * 定时任务查询请求
 *
 * @author zzh
 * 2025-11-21
 */
@Setter
@Getter
public class ScheduleTaskQueryRequest {

    /**
     * 关联资源id，数字员工id或者智能体id
     */
    private Long resourceId;

    /**
     * 转换为领域查询参数
     *
     * @return ScheduleTaskQueryDto
     */
    public ScheduleTaskQo toQueryParam() {
        ScheduleTaskQo param = new ScheduleTaskQo();
        param.setResourceId(this.resourceId);
        return param;
    }
}

