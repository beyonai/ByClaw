package com.iwhalecloud.byai.manager.dto.devloop;

import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;

import lombok.Data;

@Data
public class DevloopTaskListQueryDto {

    public static final int DEFAULT_PAGE_NUM = 1;
    public static final int DEFAULT_PAGE_SIZE = 20;
    public static final int MAX_PAGE_SIZE = 100;

    private Long projectId;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date createTimeStart;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date createTimeEnd;

    private Integer pageNum;
    private Integer pageSize;

    public void normalizeAndValidate() {
        pageNum = pageNum == null || pageNum < 1 ? DEFAULT_PAGE_NUM : pageNum;
        pageSize = pageSize == null || pageSize < 1 ? DEFAULT_PAGE_SIZE : Math.min(pageSize, MAX_PAGE_SIZE);
        if (createTimeStart != null && createTimeEnd != null && createTimeStart.after(createTimeEnd)) {
            throw new IllegalArgumentException("创建时间开始值不能晚于结束值");
        }
    }
}
