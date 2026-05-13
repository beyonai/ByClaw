package com.iwhalecloud.byai.manager.mapper.system;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.system.SysAppVersion;
import org.apache.ibatis.annotations.Param;

/**
 * 应用版本信息Mapper
 */

public interface SysAppVersionMapper extends BaseMapper<SysAppVersion> {

    /**
     * 根据设备类型查询最新版本信息
     *
     * @param deviceType 设备类型
     * @return 最新版本信息
     */
    SysAppVersion selectLatestVersionByDeviceType(@Param("deviceType") String deviceType);
}