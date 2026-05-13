package com.iwhalecloud.byai.manager.entity.men;

import com.iwhalecloud.byai.manager.vo.men.MenTaskVo;
import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * 监控服务列表查询响应
 * 
 * @author ByAI Team
 * @date 2025-01-11
 */
@Data
public class TaskListResponse implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 总记录数
     */
    private Long total;

    /**
     * 当前页码
     */
    private Integer pageNum;

    /**
     * 每页大小
     */
    private Integer pageSize;

    /**
     * 总页数
     */
    private Integer totalPages;

    /**
     * 监控服务列表
     */
    private List<MenTaskVo> list;

}
