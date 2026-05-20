ALTER TABLE byai.ss_sandbox_record
    ADD COLUMN lock_version integer DEFAULT 0 NOT NULL;

COMMENT ON COLUMN byai.ss_sandbox_record.version IS '业务生命周期版本号';
COMMENT ON COLUMN byai.ss_sandbox_record.lock_version IS '乐观锁版本号';


ALTER TABLE byai.ss_sandbox_record
    ADD COLUMN gateway_token character varying(128);

COMMENT ON COLUMN byai.ss_sandbox_record.gateway_token IS '绑定到沙箱实例的网关访问token';


UPDATE "byai"."sandbox_service_spec" SET "spec_json" = '{"env": {"TZ": "Asia/Shanghai", "LANG": "zh_CN", "MODEL_ID": "${MODEL_ID}", "NODE_ENV": "production", "USER_CODE": "${user_code}", "MODEL_NAME": "${MODEL_NAME}", "REDIS_HOST": "${REDIS_HOST}", "REDIS_PORT": "${REDIS_PORT}", "DEMO_SCHEMA": "${DEMO_SCHEMA}", "MODEL_ALIAS": "${MODEL_ALIAS}", "OPENCLAW_TZ": "Asia/Shanghai", "BEYOND_TOKEN": "${BEYOND_TOKEN}", "NODE_OPTIONS": "--max-old-space-size=4096", "BE_DOMAINNAME": "ByaiService", "MODEL_API_KEY": "${MODEL_API_KEY}", "DWS_CONFIG_DIR": "/by/.openclaw/.dws", "MODEL_BASE_URL": "${MODEL_BASE_URL}", "REDIS_DATABASE": "${REDIS_DATABASE}", "REDIS_PASSWORD": "${REDIS_PASSWORD}", "REDIS_USERNAME": "${REDIS_USERNAME}", "BAIYING_SESSION": "${BAIYING_SESSION}", "DATACLOUD_DB_HOST": "${DB_HOST}", "DATACLOUD_DB_PASS": "${DB_PASS}", "DATACLOUD_DB_PORT": "${DB_PORT}", "DATACLOUD_DB_TYPE": "${DB_TYPE}", "DATACLOUD_DB_USER": "${DB_USER}", "BAIYING_AGENT_AUTH": "${BAIYING_AGENT_AUTH}", "OPENCLAW_STATE_DIR": "/by/.openclaw", "DATACLOUD_DB_SCHEMA": "${DB_SCHEMA}", "DATACLOUD_DB_DATABASE": "${DB_DATABASE}", "DATACLOUD_DB_PASSWORD": "${DB_PASS}", "OPENCLAW_GATEWAY_TOKEN": "${OPENCLAW_GATEWAY_TOKEN}", "FILE_STORAGE_MINIO_MOUNT_PATH": "${FILE_STORAGE_MINIO_MOUNT_PATH}"}, "image": "ghcr.io/beyonai/byclaw/byclaw-openclaw:v0.0.1", "ports": [{"port": 8080, "protocol": "http"}, {"port": 8081, "protocol": "http"}, {"port": 9222, "protocol": "http"}, {"port": 5901, "protocol": "http"}, {"port": 18789, "protocol": "http"}], "startup": {"entrypoint": ["node", "dist/index.js", "gateway", "--bind=lan", "--port=8080", "--allow-unconfigured", "--verbose"]}, "timeout": 180, "volumes": [{"key": "base", "scope": "PRIVATE", "subPath": "byclaw-${user_code}/by", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/by"}], "bootstrap": {"copyTemplate": {"copyIfMissing": true, "targetVolumeKey": "base"}}, "sandboxType": "byclaw", "servicePort": 8080, "resourceLimits": {"cpu": "2", "memory": "4Gi"}}', "template_json" = '{
    "meta": {
        "lastTouchedAt": "2026-03-27T08:46:51.148Z",
        "lastTouchedVersion": "2026.3.28"
    },
    "hooks": {
        "internal": {
            "enabled": true,
            "entries": {
                "boot-md": {
                    "enabled": false
                },
                "session-memory": {
                    "enabled": true
                }
            }
        }
    },
    "tools": {
        "web": {
            "search": {
                "enabled": false
            }
        },
        "profile": "full"
    },
    "agents": {
        "list": [
            {
                "id": "main",
                "skills": [

                ],
                "default": true,
                "workspace": "${OPENCLAW_STATE_DIR}/workspace"
            }
        ],
        "defaults": {
            "model": {
                "primary": "iwhalecloud/${MODEL_ID} "
            },
            "models": {
                "iwhalecloud/glm-5-turbo": {
                    "alias": "${MODEL_ALIAS}"
                }
            },
            "subagents": {
                "maxConcurrent": 8
            },
            "compaction": {
                "mode": "safeguard"
            },
            "maxConcurrent": 4,
            "skipBootstrap": true,
            "verboseDefault": "full",
            "embeddedHarness": {
                "runtime": "skip-prewarm",
                "fallback": "pi"
            },
            "thinkingDefault": "high",
            "blockStreamingBreak": "text_end",
            "blockStreamingDefault": "on"
        }
    },
    "models": {
        "providers": {
            "iwhalecloud": {
                "api": "openai-completions",
                "apiKey": "${MODEL_API_KEY}",
                "models": [
                    {
                        "id": "${MODEL_ID}",
                        "cost": {
                            "input": 0,
                            "output": 0,
                            "cacheRead": 0,
                            "cacheWrite": 0
                        },
                        "name": "${MODEL_NAME}",
                        "input": [
                            "text"
                        ],
                        "maxTokens": 8192,
                        "reasoning": true,
                        "contextWindow": 128000
                    }
                ],
                "baseUrl": "${MODEL_BASE_URL}"
            }
        }
    },
    "skills": {
        "load": {
            "watch": true,
            "watchDebounceMs": 5000
        },
        "install": {
            "nodeManager": "pnpm"
        }
    },
    "wizard": {
        "lastRunAt": "2026-02-03T07:41:55.092Z",
        "lastRunMode": "local",
        "lastRunCommand": "configure",
        "lastRunVersion": "2026.1.30"
    },
    "gateway": {
        "auth": {
            "mode": "token",
            "token": "${OPENCLAW_GATEWAY_TOKEN}"
        },
        "bind": "lan",
        "mode": "local",
        "port": 18789,
        "controlUi": {
            "allowedOrigins": [
                "*"
            ],
            "allowInsecureAuth": true,
            "dangerouslyDisableDeviceAuth": true,
            "dangerouslyAllowHostHeaderOriginFallback": true
        },
        "tailscale": {
            "mode": "off",
            "resetOnExit": false
        }
    },
    "plugins": {
        "load": {
            "paths": [
                "/app/extensions/baiying-enhance",
                "/app/extensions/byai-channel",
                "/app/extensions/byclaw-sqlite"
            ]
        },
        "allow": [
            "byai-channel",
            "baiying-enhance",
            "byclaw-sqlite"
        ],
        "enabled": true,
        "entries": {
            "xai": {
                "enabled": false
            },
            "byai-channel": {
                "enabled": true
            },
            "byclaw-sqlite": {
                "enabled": true
            },
            "baiying-enhance": {
                "config": {
                    "watchDebounceMs": 500,
                    "mainParentAgentId": "main",
                    "workspaceAutoSeed": true,
                    "embedApiKeysFromJson": true,
                    "mergeAllowSpawnForMain": true
                },
                "enabled": true
            }
        }
    },
    "channels": {
        "byai-channel": {
            "enabled": true,
            "dmPolicy": "open",
            "allowFrom": [
                "*"
            ],
            "webhookPath": "/webhook/byai-channel",
            "streamEnabled": true,
            "blockStreaming": true,
            "sessionKeyPerSessionId": true
        }
    },
    "commands": {
        "native": "auto",
        "restart": true,
        "nativeSkills": "auto",
        "ownerDisplay": "raw"
    }
}', "updated_at" = '2026-04-08 07:57:03.636' WHERE "service_key" = 'openclaw';
