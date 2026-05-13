package com.iwhalecloud.byai.manager.qo.men;

import java.io.Serializable;
import java.util.Date;
import java.util.List;

import com.iwhalecloud.byai.manager.entity.men.MenTask;
import lombok.Data;

/**
 * 待办任务分页查询参数，继承MenTaskDto，支持多条件组合查询
 */
@Data
public class MenTaskQueryQo extends MenTask implements Serializable {

    public static final String TO_BE_PROCESSED = "TO_BE_PROCESSED";

    public static final String MY_INITIATED = "MY_INITIATED";

    public static final String PROCESSED = "PROCESSED";

    public static final String ALL = "ALL";

    /** 当前页码，从1开始，默认1 */
    private Integer pageNum = 1;

    /** 每页条数，默认10 */
    private Integer pageSize = 10;

    private Long taskId;

    /** 当前登录人 自己的待办信息 */
    private Long userId;

    /** 待我处理 TO_BE_PROCESSED，我发起的 MY_INITIATED，已处理的 PROCESSED */
    private String taskHandleType;

    /** 状态列表，支持多状态查询 */
    private List<String> statusCdList;

    /** 状态查询 not in */
    private List<String> statusCdNotList;

    /** 创建开始时间筛选 */
    private Date startTime;

    /** 创建结束时间筛选 */
    private Date endTime;

    private String taskType;

    private String title;

    /**
     * 发送人id
     */
    private Long sendObjId;

    private String resourceBizType;

    private List<String> resourceBizTypeList;
}