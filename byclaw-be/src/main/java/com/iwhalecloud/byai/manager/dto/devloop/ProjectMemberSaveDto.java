package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

import java.util.List;

/**
 * 项目成员整体保存请求参数。
 * <p>
 * userIds 表示弹窗确认后的当前成员列表，服务端会始终保留项目创建者。
 */
@Data
public class ProjectMemberSaveDto {

    /** 项目 ID。 */
    private Long projectId;

    /** 当前选中的成员用户 ID 列表；空数组表示移除全部普通成员。 */
    private List<Long> userIds;
}
