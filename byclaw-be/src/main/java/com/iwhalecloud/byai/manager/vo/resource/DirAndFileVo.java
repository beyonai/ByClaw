package com.iwhalecloud.byai.manager.vo.resource;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.HashMap;
import java.util.Map;

/**
 * @author he.duming
 * @date 2026-04-08 16:55:22
 * @description TODO
 */
@Getter
@Setter
public class DirAndFileVo {

    private Long id;

    /**
     * QA 知识库编码。
     */
    private String knCode;

    /**
     * 门户知识库资源 ID。
     */
    private Long resourceId;

    private String name;

    private String type;

    private String fileName;

    private String directoryPath;


    /**
     * 文件大小
     */
    private Long size;

    private String updatedAt;

    private String buildStatus;

    private String buildCurrentStep;

    private Long createBy;

    private String createStaffName;

}
