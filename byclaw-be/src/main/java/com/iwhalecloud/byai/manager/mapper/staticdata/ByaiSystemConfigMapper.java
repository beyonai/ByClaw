package com.iwhalecloud.byai.manager.mapper.staticdata;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import com.iwhalecloud.byai.manager.qo.staticdata.SystemConfigQo;
import com.iwhalecloud.byai.manager.vo.staticdata.SystemConfigVo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

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

    /**
     * 按参数 ID 查询一条配置。用于兼容历史脏数据里 param_id 重复的情况。
     *
     * @param paramId 参数 ID
     * @return 系统配置
     */
    ByaiSystemConfig selectOneByParamId(@Param("paramId") Long paramId);

    /**
     * 按参数 ID 删除一条配置。用于兼容历史脏数据里 param_id 重复的情况。
     *
     * @param paramId 参数 ID
     * @return 删除条数
     */
    int deleteOneByParamId(@Param("paramId") Long paramId);
}
