package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
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

    /**
     * 反查会话绑定的项目 ID，未绑定或会话不存在返回 null。
     * <p>
     * 给定时任务用：任务只知道自己跑在哪个会话里，拿不到 projectId 就得停下来等人，
     * 这里把「会话 -> 项目」这条已有关系暴露出来，避免靠名字或来源渠道猜项目。
     */
    public Long findProjectIdBySessionId(Long sessionId) {
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        return session == null ? null : session.getProjectId();
    }

}
