package com.iwhalecloud.byai.manager.vo.auth;


import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import lombok.Getter;
import lombok.Setter;

import java.util.HashMap;
import java.util.Map;

/**
 * @author he.duming
 * @date 2025-05-10 20:00:01
 * @description TODO
 */
@Getter
@Setter
public class CompareVo {

    //红名�?
    private Map<String, PrivilegeGrant> redAddMap = new HashMap<String, PrivilegeGrant>(10);

    private Map<String, PrivilegeGrant> redUpdateMap = new HashMap<String, PrivilegeGrant>(10);

    private Map<String, PrivilegeGrant> redDelMap = new HashMap<String, PrivilegeGrant>(10);

    //黑名�?
    private Map<String, PrivilegeGrant> blackAddMap = new HashMap<String, PrivilegeGrant>(10);

    private Map<String, PrivilegeGrant> blackUpdateMap = new HashMap<String, PrivilegeGrant>(10);

    private Map<String, PrivilegeGrant> blackDelMap = new HashMap<String, PrivilegeGrant>(10);


}
