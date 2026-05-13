package com.iwhalecloud.byai.manager.mapper.message;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageRel;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchRequestDto;
import com.iwhalecloud.byai.common.message.qo.MessageRelObjQo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * byai_message_relobj Mapper
 */
@Mapper
public interface ByaiMessageRelMapper extends BaseMapper<ByaiMessageRel> {

    /**
     * 单条插入
     *
     * @param item 关联对象
     * @return 插入行数
     */
    int insertOne(@Param("item") ByaiMessageRel item);

    /**
     * 批量插入
     *
     * @param list 关联对象列表
     * @return 插入行数
     */
    int insertBatch(@Param("list") List<ByaiMessageRel> list);

    /**
     * 根据 relId 查询单条记录
     *
     * @param relId 关联ID
     * @return 记录（可能为 null）
     */
    ByaiMessageRel selectByRelId(@Param("relId") Long relId);

    /**
     * 根据 relId 删除记录
     *
     * @param relId 关联ID
     * @return 删除行数
     */
    int deleteByRelId(@Param("relId") Long relId);

    /**
     * 根据 relId 选择性更新非空字段
     *
     * @param item 关联对象
     * @return 更新行数
     */
    int updateByRelId(@Param("item") ByaiMessageRel item);

    /**
     * 根据 relId 更新反馈字段，允许字段置空。
     *
     * @param item 关联对象
     * @return 更新行数
     */
    int updateFeedbackByRelId(@Param("item") ByaiMessageRel item);

    /**
     * 根据问答消息 ID 更新反馈字段，允许字段置空。
     *
     * @param item 关联对象
     * @return 更新行数
     */
    int updateFeedbackByMessagePair(@Param("item") ByaiMessageRel item);

    /**
     * 根据查询条件查询列表
     *
     * @param qo 查询条件
     * @return 记录列表
     */
    List<ByaiMessageRel> selectByQo(@Param("qo") MessageRelObjQo qo);

    /**
     * 消息关联检索 - 统计总数
     *
     * @param req 检索请求
     * @return 总数
     */
    Long countSearchMem(@Param("req") MemRelSearchRequestDto req);

    /**
     * 消息关联检索 - 分页查询
     *
     * @param req 检索请求
     * @return 结果列表（Map 结构供 Service 转 DTO）
     */
    List<ByaiMessageRel> selectSearchMemPage(@Param("req") MemRelSearchRequestDto req);
}
