package com.iwhalecloud.byai.manager.mapper.groupchat;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication;

@Mapper
public interface ByaiGroupChatPendingPublicationMapper extends BaseMapper<ByaiGroupChatPendingPublication> {
    // 上传进度独立提交；任务行锁保证替换和发布期间不会并行改写这份内容。
    @Update("UPDATE byai_group_chat_pending_publication SET uploaded_files_json = #{json}, "
        + "cloud_resource_id = #{cloudResourceId} WHERE pending_publication_id = #{id}")
    int checkpoint(@Param("id") Long id, @Param("cloudResourceId") Long cloudResourceId,
        @Param("json") String json);
}
