package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectSessionMapper;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** 项目会话关联领域服务 */
@Slf4j
@Service
public class ProjectSessionService {

    @Autowired
    private ProjectSessionMapper projectSessionMapper;

    /**
     * 按查询条件查询项目关联会话列表。 ProjectSessionQo 透传到 mapper。
     */
    public PageInfo<ByaiSessionDto> listSessionsByProject(ProjectSessionQo qo) {

        Page<ByaiSessionDto> page = PageHelper.startPage(qo.getPageNum(), qo.getPageSize());
        projectSessionMapper.selectSessionsByProjectByQo(qo);

        return PageHelperUtil.toPageInfo(page);
    }
}
