package com.iwhalecloud.byai.manager.mapper.operations;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.vo.operations.EnterpriseCloudResourceVo;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 企业云盘只读关联，不使用个人可见工作组列表。 @author Codex @since 2026-11-02 */
@Mapper
public interface EnterpriseStorageMapper extends BaseMapper<Project> {
    /** @param enterpriseId 已授权企业 @return 含保留云盘的工作组项目 */
    List<EnterpriseCloudResourceVo> selectClouds(@Param("enterpriseId") long enterpriseId);

    /** @param resourceId 已经资源鉴权的目标云盘 @return 工作组归属企业，普通资源为空 */
    List<Long> selectCloudEnterprises(@Param("resourceId") long resourceId);

    /** @param enterpriseId 企业 @return 已有商业托管标记，策略暂缺时不能当作开源企业 */
    boolean commerciallyManaged(@Param("enterpriseId") long enterpriseId);

    /** @param enterpriseId 企业 @param actorId 可信服务传入的用户 @return 是否可读取企业汇总 */
    boolean canRead(@Param("enterpriseId") long enterpriseId, @Param("actorId") long actorId);
}
