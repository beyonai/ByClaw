package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * AI 预拆入参:只定位需求,仓库清单与提示词由后端自己查,前端不传业务上下文。
 * 预拆纯读+调模型,不落库;确认启动仍走 {@link RequirementSplitDTO} 的批量入口。
 */
@Data
public class RequirementPresplitDTO {

    /** 研发项目ID,用于取该项目的仓库清单。 */
    private Long projectId;

    /** 待预拆的需求ID ScanRequireItem.itemId。 */
    private Long sourceItemId;
}
