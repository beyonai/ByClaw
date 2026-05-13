package com.iwhalecloud.byai.manager.vo.resource;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * @author he.duming
 * @date 2026-04-08 16:55:22
 * @description TODO
 */
@Getter
@Setter
public class DirAndFileVo {

    private Long id;

    private String name;

    private String type;

    private Long fileId;

    private String fileName;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    private Long createBy;

    private String createStaffName;

    private String directoryPath;

}
