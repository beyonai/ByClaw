package com.iwhalecloud.byai.manager.mapper.enterprise;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.enterprise.EnterpriseInfo;

public interface EnterpriseInfoMapper extends BaseMapper<EnterpriseInfo> {

    /**
     * 查询企业标识
     *
     * @return Long
     */
    Long getEnterpriseId();
}
