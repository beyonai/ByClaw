package com.iwhalecloud.byai.manager.mapper.source;

import java.util.List;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.source.SourceSystem;

public interface SourceSystemMapper extends BaseMapper<SourceSystem> {

    List<SourceSystem> getSourceSystemList();

    @org.apache.ibatis.annotations.Select("SELECT app_secret FROM po_source_system WHERE system_code='BYAI_PLATFORM'")
    List<String> selectPlatformIdentitySecrets();

}
