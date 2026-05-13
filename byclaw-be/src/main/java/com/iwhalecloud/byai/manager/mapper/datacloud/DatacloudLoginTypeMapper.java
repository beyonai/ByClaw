package com.iwhalecloud.byai.manager.mapper.datacloud;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudLoginTypeDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudLoginTypeQueryDTO;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudLoginType;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 登录类型表Mapper接口
 * 
 * @author system
 * @date 2025-01-15
 */
@Mapper
public interface DatacloudLoginTypeMapper extends BaseMapper<DatacloudLoginType> {

    /**
     * 分页查询登录类型列表
     * 
     * @param page 分页参数
     * @param query 查询条件
     * @return 登录类型列表
     */
    List<DatacloudLoginTypeDTO> selectLoginTypeListByPage(Page<DatacloudLoginTypeDTO> page,
                                                          @Param("query") DatacloudLoginTypeQueryDTO query);

    /**
     * 查询所有启用的登录类型
     * 
     * @param enterpriseId 企业ID
     * @return 启用的登录类型列表
     */
    List<DatacloudLoginTypeDTO> selectActiveLoginTypes(@Param("enterpriseId") Long enterpriseId);

    /**
     * 检查登录类型编码是否存在
     * 
     * @param loginTypeCode 登录类型编码
     * @param enterpriseId 企业ID
     * @param excludeId 排除的登录类型ID（用于更新时检查）
     * @return 存在的记录数
     */
    int checkLoginTypeCodeExists(@Param("loginTypeCode") String loginTypeCode, 
                                 @Param("enterpriseId") Long enterpriseId, 
                                 @Param("excludeId") Long excludeId);

    /**
     * 统计登录类型关联的脚本数量
     * 
     * @param loginTypeId 登录类型ID
     * @return 脚本数量
     */
    int countScriptsByLoginType(@Param("loginTypeId") Long loginTypeId);

    /**
     * 查询登录类型统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    java.util.Map<String, Object> selectLoginTypeStatistics(@Param("enterpriseId") Long enterpriseId);

    /**
     * 批量删除登录类型
     * 
     * @param loginTypeIds 登录类型ID列表
     * @param enterpriseId 企业ID
     * @return 删除记录数
     */
    int batchDeleteLoginTypes(@Param("loginTypeIds") List<Long> loginTypeIds, 
                             @Param("enterpriseId") Long enterpriseId);
}
