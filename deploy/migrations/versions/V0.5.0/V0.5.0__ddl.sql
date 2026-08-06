-- V0.5.0 增量 DDL：将原由 byclaw-super 维护的 Agent 能力卡（capability card）持久化结构纳入 byclaw-be。
-- 表结构与 byclaw-super 的 agent_capability_cards 保持一致，便于现有数据平滑过渡；采用幂等方式，支持升级脚本安全重放。
SET search_path TO byai;

-- Agent 能力卡快照：按 (system_code, agent_id) 唯一，仅保存编译产物，用户权限仍由权威 Agent Catalog（ss_resource）管理。
CREATE TABLE IF NOT EXISTS byai.agent_capability_cards
(
    system_code       VARCHAR(64)  NOT NULL,
    agent_id          VARCHAR(200) NOT NULL,
    agent_code        VARCHAR(128),
    agent_name        VARCHAR(200),
    schema_version    VARCHAR(64)  NOT NULL,
    generator_version VARCHAR(32)  NOT NULL,
    source_version    VARCHAR(128),
    source_fingerprint VARCHAR(128) NOT NULL,
    card              TEXT         NOT NULL,
    routing_text      VARCHAR(1024),
    quality           TEXT,
    status            VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    version           INT          NOT NULL DEFAULT 0,
    created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_agent_capability_cards PRIMARY KEY (system_code, agent_id)
);

-- 指纹变化时快速定位；状态过滤服务于后续路由读取。
CREATE INDEX IF NOT EXISTS idx_agent_capability_cards_fingerprint
    ON byai.agent_capability_cards (source_fingerprint);

CREATE INDEX IF NOT EXISTS idx_agent_capability_cards_status
    ON byai.agent_capability_cards (status);
