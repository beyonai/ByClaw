package com.iwhalecloud.byai.manager.mapper.staticdata;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import com.iwhalecloud.byai.manager.qo.staticdata.SystemConfigQo;
import com.iwhalecloud.byai.manager.vo.staticdata.SystemConfigVo;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface ByaiSystemConfigMapper extends BaseMapper<ByaiSystemConfig> {

    /**
     * 缓存管理查询
     * 
     * @param systemConfigQo 查询对象
     * @return List
     */
    List<SystemConfigVo> selectSystemConfigByQo(SystemConfigQo systemConfigQo);
}
