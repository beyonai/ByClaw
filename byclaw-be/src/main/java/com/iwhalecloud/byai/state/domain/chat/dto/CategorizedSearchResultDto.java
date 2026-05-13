package com.iwhalecloud.byai.state.domain.chat.dto;

import com.iwhalecloud.byai.state.domain.chat.model.ChatRelatedResource;
import lombok.Data;

import java.util.List;

/**
 * 分类搜索结果DTO
 * 用于存储分类的搜索结果，包含上传日期和资源列表
 */
@Data
public class CategorizedSearchResultDto {
    
    /**
     * 上传日期（格式：yyyy-MM-dd HH:mm:ss）
     */
    private String uploadDate;
    
    /**
     * 资源列表
     */
    private List<ChatRelatedResource> resources;
    
    public CategorizedSearchResultDto() {
    }
    
    public CategorizedSearchResultDto(String uploadDate, List<ChatRelatedResource> resources) {
        this.uploadDate = uploadDate;
        this.resources = resources;
    }
}
