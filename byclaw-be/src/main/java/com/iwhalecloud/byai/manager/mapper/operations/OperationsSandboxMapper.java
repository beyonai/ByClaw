package com.iwhalecloud.byai.manager.mapper.operations;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.vo.operations.OperationsSandboxVo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;
import java.util.Map;

/** 运营沙箱投影与乐观版本认领。
 * @author Codex
 * @since 2026-10-23
 */
@Mapper
public interface OperationsSandboxMapper extends BaseMapper<SsSandboxRecord> {
    /** 查询包含历史记录的分页投影。 */
    List<OperationsSandboxVo> selectRows(@Param("query") Map<String, Object> query);
    /** 读取记录及当前资源版本。 */
    OperationsSandboxVo selectDetail(@Param("id") long id);
    /** 调用外部服务前消费展示版本，不持有数据库事务等待网络。 */
    int claim(@Param("record") OperationsSandboxVo record, @Param("action") String action);
}

