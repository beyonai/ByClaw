package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Getter;
import lombok.Setter;

import java.util.Set;

/**
 * 当前项目上下文查询参数。
 */
@Getter
@Setter
public class ProjectContextQueryDto {

    /** 优先使用聊天 metadata 中的项目 ID。 */
    private Long projectId;

    /** projectId 缺失时，按当前会话反查项目。 */
    private Long sessionId;

    /** 可选返回分区；空集合表示返回全部。 */
    private Set<String> sections;

    /** 共享文件最大返回条数，默认 50，最大 100。 */
    private Integer pageSize;
}
