package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 群响应只读投影；创建者 Codex，2026-11-13。 */
@Mapper
public interface ByaiGroupChatResponseMapper {
    List<String> selectIdsBySource(@Param("groupId") Long groupId, @Param("sourceId") Long sourceId);

    /** 查询本群执行；ids 非空时读取包含终态的指定响应。 */
    List<Map<String, Object>> selectResponses(@Param("groupId") Long groupId,
        @Param("cursor") String cursor, @Param("limit") int limit, @Param("ids") List<String> ids);
}
