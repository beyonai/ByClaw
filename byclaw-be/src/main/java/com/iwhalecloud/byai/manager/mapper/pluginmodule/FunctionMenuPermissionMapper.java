package com.iwhalecloud.byai.manager.mapper.pluginmodule;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.pluginmodule.FunctionMenuPermission;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface FunctionMenuPermissionMapper extends BaseMapper<FunctionMenuPermission> {

    int batchInsert(@Param("list") List<FunctionMenuPermission> permissions);

    List<FunctionMenuPermission> selectByEmployeeId(@Param("employeeId") Long employeeId);
}
