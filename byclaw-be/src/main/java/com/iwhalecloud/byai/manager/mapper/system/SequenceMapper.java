package com.iwhalecloud.byai.manager.mapper.system;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.system.Sequence;
import org.apache.ibatis.annotations.Param;

/**
 * 序列管理数据访问层接口提供不同数据库类型的序列生成和操作方法
 * 
 * @author he.duming
 * @date 2025-07-30 11:29:24
 * @description 序列管理Mapper接口，支持多种数据库的序列生成策略
 */
public interface SequenceMapper extends BaseMapper<Sequence> {

    /**
     * 获取Udal数据库的下一个序列值适用于Udal数据库的序列生成策略
     * 
     * @param sequenceName 序列名称，通常格式为SEQ_表名"
     * @return 下一个序列值
     */
    Long nextValForUdal(@Param("sequenceName") String sequenceName);

    /**
     * 获取Oracle数据库的下一个序列值使用Oracle的序列对象生成下一个值
     * 
     * @param sequenceName 序列名称，通常格式为SEQ_表名"
     * @return 下一个序列值
     */
    Long nextValForOracle(@Param("sequenceName") String sequenceName);

    /**
     * 获取PostgreSQL数据库的下一个序列值使用PostgreSQL的序列对象生成下一个值
     * 
     * @param sequenceName 序列名称，通常格式为SEQ_表名"
     * @return 下一个序列值
     */
    Long nextValForPostgreSql(@Param("sequenceName") String sequenceName);

    /**
     * 获取MySQL数据库的自增序列值通过插入临时记录获取自增ID，然后删除该记录
     * 
     * @return 下一个自增序列值
     */
    Long nextValForMySqlIncrement();

    /**
     * 清理MySQL自增序列的临时记录删除指定ID的临时记录，用于维护序列的连续性
     * 
     * @param id 要删除的记录ID
     */
    void clearMySqlIncrement(@Param("id") Long id);
}
