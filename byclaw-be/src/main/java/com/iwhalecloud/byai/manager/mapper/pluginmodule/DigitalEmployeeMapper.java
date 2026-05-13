package com.iwhalecloud.byai.manager.mapper.pluginmodule;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.pluginmodule.DigitalEmployee;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface DigitalEmployeeMapper extends BaseMapper<DigitalEmployee> {

    DigitalEmployee selectByCode(@Param("employeeCode") String employeeCode);

    boolean existsByCode(@Param("employeeCode") String employeeCode);
}
