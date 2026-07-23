-- V0.3.0 需求收集模块
-- 项目表
CREATE TABLE IF NOT EXISTS byai.byai_project
(
    project_id   BIGINT       NOT NULL,
    project_name VARCHAR(100) NOT NULL,
    description  VARCHAR(500),
    resource_id  BIGINT,
    project_type VARCHAR(20)  NOT NULL DEFAULT 'normal',
    is_share     VARCHAR(10)  NOT NULL DEFAULT 'N',
    create_by    BIGINT,
    create_time  TIMESTAMP             DEFAULT CURRENT_TIMESTAMP,
    update_by    BIGINT,
    update_time  TIMESTAMP             DEFAULT CURRENT_TIMESTAMP,
    delete_flag  CHAR(1)               DEFAULT '0',
    CONSTRAINT pk_byai_project PRIMARY KEY (project_id)
);

COMMENT ON TABLE byai.byai_project IS '项目表';
COMMENT ON COLUMN byai.byai_project.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project.project_name IS '项目名称';
COMMENT ON COLUMN byai.byai_project.description IS '项目描述';
COMMENT ON COLUMN byai.byai_project.resource_id IS '关联Agent资源ID';
COMMENT ON COLUMN byai.byai_project.project_type IS '项目类型：normal普通项目，develop研发项目';
COMMENT ON COLUMN byai.byai_project.is_share IS '是否分享：N-不分享，Y-可分享';
COMMENT ON COLUMN byai.byai_project.create_by IS '创建人';
COMMENT ON COLUMN byai.byai_project.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_project.update_by IS '更新人';
COMMENT ON COLUMN byai.byai_project.update_time IS '更新时间';
COMMENT ON COLUMN byai.byai_project.delete_flag IS '删除标记 0正常 1删除';

-- 项目关联会话
ALTER TABLE byai_session ADD COLUMN project_id BIGINT NOT NULL DEFAULT -1;
COMMENT ON COLUMN byai_session.project_id IS '项目ID,-1代表无归属项目,即默认项目';

-- 项目关联成员
CREATE TABLE IF NOT EXISTS byai.byai_project_member
(
    member_id   BIGINT NOT NULL,
    project_id  BIGINT NOT NULL,
    user_id     BIGINT,
    role        VARCHAR(32) DEFAULT 'member',
    agent_id    BIGINT,
    create_time TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_project_member PRIMARY KEY (member_id)
);

COMMENT ON TABLE byai.byai_project_member IS '项目成员表';
COMMENT ON COLUMN byai.byai_project_member.member_id IS '记录ID';
COMMENT ON COLUMN byai.byai_project_member.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project_member.user_id IS '用户ID';
COMMENT ON COLUMN byai.byai_project_member.role IS '角色: owner/member';
COMMENT ON COLUMN byai.byai_project_member.agent_id IS '关联的默认数字员工ID';
COMMENT ON COLUMN byai.byai_project_member.create_time IS '加入时间';

CREATE INDEX IF NOT EXISTS idx_project_member_project ON byai.byai_project_member (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_member_unique ON byai.byai_project_member (project_id, user_id);

-- 项目仓库关联表
CREATE TABLE IF NOT EXISTS byai.byai_project_repo
(
    repo_id        BIGINT       NOT NULL,
    project_id     BIGINT       NOT NULL,
    repo_full_name VARCHAR(200) NOT NULL,
    repo_url       VARCHAR(500),
    default_branch VARCHAR(100) DEFAULT 'main',
    create_by      VARCHAR(64),
    create_time    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_project_repo PRIMARY KEY (repo_id)
);

COMMENT ON TABLE byai.byai_project_repo IS '项目仓库关联表';
COMMENT ON COLUMN byai.byai_project_repo.repo_id IS '仓库记录ID';
COMMENT ON COLUMN byai.byai_project_repo.project_id IS '所属项目ID';
COMMENT ON COLUMN byai.byai_project_repo.repo_full_name IS '仓库全名 owner/repo';
COMMENT ON COLUMN byai.byai_project_repo.repo_url IS '仓库地址';
COMMENT ON COLUMN byai.byai_project_repo.default_branch IS '默认分支';

-- 项目空间共享文件表
CREATE TABLE IF NOT EXISTS byai.byai_project_share_file
(
    share_id    BIGINT PRIMARY KEY NOT NULL,
    project_id  BIGINT,
    file_id     BIGINT             NOT NULL,
    share_link  VARCHAR(1000),
    create_by   BIGINT,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE byai.byai_project_share_file IS '项目空间共享文件表';
COMMENT ON COLUMN byai.byai_project_share_file.share_id IS '共享记录ID';
COMMENT ON COLUMN byai.byai_project_share_file.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project_share_file.file_id IS '文件ID';
COMMENT ON COLUMN byai.byai_project_share_file.share_link IS '分享链接';
COMMENT ON COLUMN byai.byai_project_share_file.create_by IS '创建人';
COMMENT ON COLUMN byai.byai_project_share_file.create_time IS '创建时间';


INSERT INTO byai.byai_project (project_id, project_name, description, resource_id, create_by, create_time, update_by, update_time, delete_flag, project_type, is_share) VALUES (-1, '我的默认项目', '未分类会话和历史文件', null, 10001, '2099-12-28 10:55:49.000000', 10001, '2026-07-16 19:38:40.736000', '0', 'default', 'N');

delete from byai.byai_system_config_list where param_group_code in('PROJECT_TYPE');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'PROJECT_TYPE', '项目类型', '普通项目', 'normal', 'normal', '普通项目', 1);

