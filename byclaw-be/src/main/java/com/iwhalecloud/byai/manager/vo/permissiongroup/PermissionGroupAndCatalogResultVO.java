package com.iwhalecloud.byai.manager.vo.permissiongroup;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * 权限组和目录联合查询结果视图对象
 * 包含目录列表和权限组信息列表
 */
@Getter
@Setter
public class PermissionGroupAndCatalogResultVO {

    /**
     * 目录列表
     */
    private List<CatalogSimpleVO> catalogList = new ArrayList<>();

    /**
     * 权限组信息列表（包含目录信息和标签列表）
     */
    private List<PermissionGroupWithCatalogVO> biPrivGroupInfoList = new ArrayList<>();

}

