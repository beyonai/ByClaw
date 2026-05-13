package com.iwhalecloud.byai.manager.entity.auth;

import lombok.Data;
import lombok.EqualsAndHashCode;
import org.apache.commons.lang3.StringUtils;

import java.util.Arrays;
import java.util.List;
import java.util.Objects;

/**
 * 包含组织和驻地路径信息的权限授权记录
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class PrivilegeGrantWithOrgPath extends PrivilegeGrant {
    
    /**
     * 组织路径（从po_organization表联表查询获得）
     */
    private String orgPath;
    
    /**
     * 驻地路径（从po_station表联表查询获得）
     */
    private String stationPath;


    /**
     * 是否全公司可见
     * @return
     */
    public boolean isCompanyWideOrg() {
        if (!"ORG".equals(getGrantToObjType())) {
            return false;
        }
        if (StringUtils.isBlank(getOrgPath()) || getGrantToObjId() == null) {
            return false;
        }
        List<String> path = Arrays.asList(getOrgPath().split("\\."));
        return path.size() == 2
                && "-1".equals(path.get(0))
                && Objects.equals(getGrantToObjId(), path.get(1));
    }
    

    
    /**
     * 判断当前驻地是否是另一个驻地的子驻地
     */
    public boolean isChildOfStation(String parentStationPath) {
        if (stationPath == null || parentStationPath == null) {
            return false;
        }
        // 检查子驻地路径是否以父驻地路径加.开头
        // 例如：父路径"1.2.3"，子路径"1.2.3.4.5"才算是子级
        return stationPath.startsWith(parentStationPath + ".");
    }
} 