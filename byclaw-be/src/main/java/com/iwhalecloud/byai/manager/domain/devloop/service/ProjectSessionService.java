package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 项目会话查询服务（基于 byai_session.project_id）。
 */
@Slf4j
@Service
public class ProjectSessionService {

    @Autowired
    private ByaiSessionMapper byaiSessionMapper;

    /**
     * 按查询条件查询项目关联会话列表。
     */
    public PageInfo<ByaiSessionDto> listSessionsByProject(ProjectSessionQo qo) {
        Page<ByaiSessionDto> page = PageHelper.startPage(qo.getPageNum(), qo.getPageSize());
        byaiSessionMapper.selectSessionsByProjectByQo(qo);
        return PageHelperUtil.toPageInfo(page);
    }

}
