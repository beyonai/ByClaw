package com.iwhalecloud.byai.manager.mapper.datacloud;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptTemplate;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 脚本模板表Mapper接口
 * 用于管理脚本模板的数据访问操作
 * 
 * @author system
 * @date 2025-01-15
 */
@Mapper
public interface DatacloudScriptTemplateMapper extends BaseMapper<DatacloudScriptTemplate> {

    /**
     * 分页查询脚本模板列表
     * 
     * @param page 分页参数
     * @param templateType 模板类型
     * @param framework 框架类型
     * @param enterpriseId 企业ID
     * @return 模板列表
     */
    List<DatacloudScriptTemplate> selectTemplateListByPage(Page<DatacloudScriptTemplate> page,
                                                          @Param("templateType") String templateType,
                                                          @Param("framework") String framework,
                                                          @Param("enterpriseId") Long enterpriseId);

    /**
     * 查询可用的脚本模板列表
     * 
     * @param templateType 模板类型
     * @param framework 框架类型
     * @param enterpriseId 企业ID
     * @return 模板列表
     */
    List<DatacloudScriptTemplate> selectAvailableTemplates(@Param("templateType") String templateType,
                                                          @Param("framework") String framework,
                                                          @Param("enterpriseId") Long enterpriseId);

}
