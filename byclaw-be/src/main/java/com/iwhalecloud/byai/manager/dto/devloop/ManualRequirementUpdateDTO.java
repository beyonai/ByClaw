package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * 修改手工录入需求的请求参数。
 * 仅允许更新尚未启动研发任务的手工需求，项目归属由后端根据需求条目反查，避免由请求参数篡改。
 */
@Data
public class ManualRequirementUpdateDTO {

    /** 待修改的需求条目 ID。 */
    private Long itemId;

    /** 稳定的来源标识：manual、customer_feedback 或 internal_proposal。 */
    private String sourceType;

    /** 可选的受影响分支上下文。 */
    private String branch;

    /** 可选的关联项目仓库 ID；修改时覆盖该需求原有的仓库关联。 */
    private Long repoId;

    /** 必填的需求标题。 */
    private String title;

    /** 必填的提交者原始需求文本。 */
    private String originalContent;

    /** 可选的产品层上下文。 */
    private String productContent;
}
