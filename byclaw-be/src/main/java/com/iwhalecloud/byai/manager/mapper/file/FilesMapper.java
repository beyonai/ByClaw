package com.iwhalecloud.byai.manager.mapper.file;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.file.UploadFilesRespDto;
import com.iwhalecloud.byai.manager.entity.file.Files;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-01-02 13:33:58
 * @description TODO
 */
public interface FilesMapper extends BaseMapper<Files> {

    /**
     * 批量插入文件记录（用于联网搜索归档等场景，保证与 web_crawl_doc_archive 同事务）
     *
     * @param list 文件实体列表
     * @return 影响行数
     */
    int insertBatch(@Param("list") List<Files> list);

    /**
     * 根据标识查询上传文件接口
     * 
     * @param chatId 会话标识
     * @param tags 标志
     * @param matchMode 匹配模式
     * @return List<UploadFilesRespDto>
     */
    List<UploadFilesRespDto> selectByMatchTags(@Param("chatId") Long chatId, @Param("tags") String tags,
        @Param("matchMode") String matchMode);
}
