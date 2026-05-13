package com.iwhalecloud.byai.manager.qo.auth;

import com.iwhalecloud.byai.common.vo.SortField;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-05-10 17:49:41
 * @description TODO
 */
@Getter
@Setter
public class OwnAuthQo {

    @NotNull(message = "{ownauthqo.page.notnull}")
    private Long pageNum;

    @NotNull(message = "{ownauthqo.pageSize.notnull}")
    private Long pageSize;

    @NotNull(message = "{ownauthqo.orgid.notnull}")
    private Long orgId;

    @NotNull(message = "{ownauthqo.statusList.notnull}")
    private List<Integer> statusList;

    /**
     * 资源名称模糊查询
     */
    private String resourceName;

//    /**
//     * true:表示为资源， false：表示为数字员工
//     */
//    private Boolean isResource;

    /**
     * 用户的管理组织，管理员只能看管理组织
     */
    private List<Long> mangerOrgIds;

    /**
     * 授权资源类型
     */
    private List<String> grantObjTypes;

    /**
     * 所属目录ID
     */
    private Long catalogId;

    /**
     * 排序字段列表
     */
    private List<SortField> sortFields;

}
