package com.iwhalecloud.byai.manager.mapper.sandbox;

import java.util.Date;
import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxResizeRecord;

@Mapper
public interface SsSandboxResizeRecordMapper {

    int insert(SsSandboxResizeRecord record);

    int updateResult(@Param("id") Long id,
                     @Param("status") String status,
                     @Param("success") Integer success,
                     @Param("finishedAt") Date finishedAt,
                     @Param("durationMs") Long durationMs,
                     @Param("opensandboxRequestId") String opensandboxRequestId,
                     @Param("opensandboxResponse") String opensandboxResponse,
                     @Param("errorMessage") String errorMessage);

    List<SsSandboxResizeRecord> selectBySandboxRecordId(@Param("sandboxRecordId") Long sandboxRecordId,
                                                        @Param("limit") int limit);
}
