package com.iwhalecloud.byai.manager.mapper.mode;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.mode.ModeRelationDto;
import com.iwhalecloud.byai.manager.entity.mode.ByaiMode;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 模式与数字员工关联Mapper
 *
 * @author system
 */
@Mapper
public interface ByaiModeMapper extends BaseMapper<ByaiMode> {

    List<ModeRelationDto> selectRelationByModeCode(@Param("modeCode") String modeCode);

    List<ByaiMode> selectList();
}
