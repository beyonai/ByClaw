package com.iwhalecloud.byai.state.domain.sys.service;

import com.iwhalecloud.byai.manager.entity.system.SysAppVersion;
import com.iwhalecloud.byai.manager.mapper.system.SysAppVersionMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 应用版本信息服务实现类
 */
@Service
public class SysAppVersionService {

    @Autowired
    private SysAppVersionMapper sysAppVersionMapper;


    public SysAppVersion getLatestVersion(String deviceType) {
        return sysAppVersionMapper.selectLatestVersionByDeviceType(deviceType);
    }
} 