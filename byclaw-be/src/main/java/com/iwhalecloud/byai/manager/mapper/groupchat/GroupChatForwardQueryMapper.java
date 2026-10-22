package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos.TargetItem;

/** Dedicated forwarding selection; legacy sidebar semantics remain independent. */
@Mapper
public interface GroupChatForwardQueryMapper {
    List<TargetItem> selectTargets(@Param("userId") Long userId, @Param("enterpriseId") Long enterpriseId,
        @Param("sourceId") Long sourceId, @Param("keyword") String keyword, @Param("size") int size, @Param("offset") long offset);
    long countTargets(@Param("userId") Long userId, @Param("enterpriseId") Long enterpriseId,
        @Param("sourceId") Long sourceId, @Param("keyword") String keyword);
}
