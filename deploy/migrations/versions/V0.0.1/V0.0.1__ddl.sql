
ALTER TABLE byai.ss_sandbox_record
    ADD COLUMN lock_version integer DEFAULT 0 NOT NULL;



COMMENT ON COLUMN byai.ss_sandbox_record.version IS '业务生命周期版本号';


COMMENT ON COLUMN byai.ss_sandbox_record.lock_version IS '乐观锁版本号';




ALTER TABLE byai.ss_sandbox_record
    ADD COLUMN gateway_token character varying(128);



COMMENT ON COLUMN byai.ss_sandbox_record.gateway_token IS '绑定到沙箱实例的网关访问token';
