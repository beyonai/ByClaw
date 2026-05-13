package com.iwhalecloud.byai.manager.vo.men;

import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * @author he.duming
 * @date 2026-01-15 15:33:40
 * @description TODO
 */
@Getter
@Setter
public class FixedMemoryMemoryTaskVo {

    private Long taskId;

    private String taskType;

    private String title;

    private Date createTime;

    private String content;

    private Long resComId;

    private String resPage;

}
