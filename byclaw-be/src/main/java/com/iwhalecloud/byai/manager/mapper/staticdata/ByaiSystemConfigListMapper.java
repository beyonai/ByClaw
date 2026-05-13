package com.iwhalecloud.byai.manager.mapper.staticdata;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.staticdata.SystemConfigListDTO;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.manager.vo.staticdata.SystemConfigListGroupVo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;

/**
 * 系统配置列表Mapper接口
 */
@Mapper
public interface ByaiSystemConfigListMapper extends BaseMapper<ByaiSystemConfigList> {

    /**
     * 查询对象
     * 
     * @param qo 分组查询
     * @return List<SystemConfigListGroupVo>
     */
    List<SystemConfigListGroupVo> selectSystemConfigListGroupByQo(QueryObject qo);

    /**
     * 分组详情查询
     * 
     * @param paramGroupCode 分组编码
     * @return SystemConfigListDTO
     */
    SystemConfigListDTO selectByParamGroupCode(@Param("paramGroupCode") String paramGroupCode);

}
