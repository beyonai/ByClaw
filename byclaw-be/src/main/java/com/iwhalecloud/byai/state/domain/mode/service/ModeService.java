package com.iwhalecloud.byai.state.domain.mode.service;

import com.iwhalecloud.byai.manager.dto.mode.ModeDto;
import com.iwhalecloud.byai.manager.dto.mode.ModeRelationDto;
import com.iwhalecloud.byai.manager.mapper.mode.ByaiModeMapper;
import com.iwhalecloud.byai.manager.entity.mode.ByaiMode;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 模式与数字员工关联领域服务
 *
 * @author system
 */
@Service
public class ModeService {

    @Autowired
    private ByaiModeMapper byaiModeMapper;

    public List<ModeDto> getModelList() {
        // 1.首先查出来有哪些模型
        List<ByaiMode> byaiModes = byaiModeMapper.selectList();
        List<ModeDto> res = new ArrayList<>();
        // 2.查询关联的数字员工
        List<ModeRelationDto> searchQuery = byaiModeMapper.selectRelationByModeCode("search_query");
        for (ByaiMode byaiMode : byaiModes) {
            ModeDto modeDto = new ModeDto();
            BeanUtils.copyProperties(byaiMode, modeDto);
            if (modeDto.getModeCode().equals("search_query")) {
                modeDto.setRelations(searchQuery);
            }
            res.add(modeDto);
        }
        return res;
    }
}
