package com.iwhalecloud.byai.manager.vo.resource;

import com.iwhalecloud.byai.manager.entity.resource.SsResExtTestSet;
import lombok.Getter;
import lombok.Setter;

/**
 * 数字员工测试集查看对象
 * @author zzh
 */
@Getter
@Setter
public class SsResExtTestSetVo extends SsResExtTestSet {

    /**
     * 处理状态名称
     */
    private String processStatusName;

}
