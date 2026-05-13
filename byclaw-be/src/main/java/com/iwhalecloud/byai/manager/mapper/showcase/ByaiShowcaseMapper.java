package com.iwhalecloud.byai.manager.mapper.showcase;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.manager.qo.showcase.ShowcaseQueryParam;
import com.iwhalecloud.byai.manager.vo.showcase.ByaiShowcaseVo;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 成果空间表Mapper
 *
 * @author system
 * @date 2025-11-10
 */
@Mapper
public interface ByaiShowcaseMapper {

    /**
     * 新增成果空间记录
     *
     * @param record 成果空间实体
     * @return 影响条数
     */
    int insert(ByaiShowcase record);

    /**
     * 批量插入成果空间记录
     *
     * @param list 成果空间实体列表
     * @return 影响条数
     */
    int insertBatch(@Param("list") List<ByaiShowcase> list);

    /**
     * 根据主键更新成果空间记录
     *
     * @param record 成果空间实体
     * @return 影响条数
     */
    int updateById(ByaiShowcase record);

    /**
     * 根据主键删除成果空间记录
     *
     * @param id 主键
     * @return 影响条数
     */
    int deleteById(@Param("id") Long id);

    /**
     * 根据主键查询成果空间记录
     *
     * @param id 主键
     * @return 成果空间实体
     */
    ByaiShowcase selectById(@Param("id") Long id);

    /**
     * 按条件查询成果空间列表
     * 
     * @return 成果空间集合
     */
    List<ByaiShowcaseVo> selectByCondition(ShowcaseQueryParam queryParam);

    /**
     * 根据条件更新成果状态
     *
     * @param sessionId 会话ID
     * @param type 成果类型
     * @param fileCode 文件编码
     * @param messageId 消息ID
     * @param status 状态值
     * @return 影响条数
     */
    int updateStatusByCondition(@Param("sessionId") Long sessionId, @Param("type") String type,
        @Param("fileCode") String fileCode, @Param("messageId") Long messageId, @Param("status") Integer status,
        @Param("updateTime") java.util.Date updateTime);

    /**
     * 查询同一会话中已逻辑删除的成果记录
     *
     * @param sessionId 会话ID
     * @param type 成果类型
     * @param messageId 消息ID
     * @param fileCode 文件编码
     * @return 已逻辑删除的成果
     */
    ByaiShowcase selectDeletedRecord(@Param("sessionId") Long sessionId, @Param("type") String type,
        @Param("messageId") Long messageId, @Param("fileCode") String fileCode);
}
