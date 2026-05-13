package com.iwhalecloud.byai.manager.mapper.men;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.men.MenTaskRecObj;
import com.iwhalecloud.byai.manager.vo.men.MenTaskRecObjVo;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 待办任务接收对象表Mapper
 */
public interface MenTaskRecObjMapper extends BaseMapper<MenTaskRecObj> {

    List<MenTaskRecObj> selectByTaskId(@Param("taskId") Long taskId);

    int insertBatch(List<MenTaskRecObj> record);

    int deleteByTaskId(@Param("taskId") Long taskId);

    List<MenTaskRecObjVo> selectTaskResUserByTaskId(@Param("taskId") Long taskId);

}