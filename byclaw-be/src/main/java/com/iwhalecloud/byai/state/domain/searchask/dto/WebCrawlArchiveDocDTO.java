package com.iwhalecloud.byai.state.domain.searchask.dto;

import com.iwhalecloud.byai.manager.entity.searchask.WebCrawlArchiveDoc;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * WebCrawlArchiveDocDTO
 * */
@EqualsAndHashCode(callSuper = true)
@Data
public class WebCrawlArchiveDocDTO extends WebCrawlArchiveDoc {

    /**
     * FileUrl
     */
    private String fileUrl;

}
