package com.iwhalecloud.byai.manager.dto.aimodel;

import java.io.Serializable;
import java.util.List;
import lombok.Data;

/**
 * 模型列表响应（分页）
 * 与接口文档 getModelListByPage 出参 data 一致
 *
 * @author system
 */
@Data
public class ModelListResponse implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 列表数据（列表仅返回 apiTokenMasked，不返回明文 apiToken） */
    private List<ModelVO> rows;

    /** 当前页码 */
    private Integer pageIndex;

    /** 每页条数 */
    private Integer pageSize;

    /** 总条数 */
    private Long total;
}
