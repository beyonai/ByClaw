package com.iwhalecloud.byai.manager.mapper.datacloud;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DataCloudScriptView;
import com.iwhalecloud.byai.manager.dto.datacloud.DataCloudScriptViewQueryDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DataCloudViewScriptDTO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/10/11 17:28
 */
@Mapper
public interface DataCloudScriptViewMapper extends BaseMapper<DataCloudScriptView> {


    /**
     * 分页查询脚本视图列表
     * @return 脚本视图列表
     */
    List<DataCloudViewScriptDTO> selectScriptListByPage(Page<DataCloudViewScriptDTO> page,
                                                            @Param("query") DataCloudScriptViewQueryDTO query);
}
