update byai.po_users_organization set position_id =1 where  position_id not in(select position_id from byai.po_position);

delete from byai.byai_system_config where param_code in('SYSTEM_BACKEND_MENU_MANAGE');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (10000375, null, 'SYSTEM_BACKEND_MENU_MANAGE', '后台菜单管理', 'SYSTEM_BACKEND_MENU_MANAGE', '[
    {
        "menuCode": "menu_org",
        "menuNameEn": "Organization Structure",
        "menuNameCn": "组织结构管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 1,
        "path": "/manager/org/orgMgr"
    },
    {
        "menuCode": "menu_staff_post",
        "menuNameEn": "Employee Post",
        "menuNameCn": "员工岗位管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 2,
        "path": "/manager/org/postManage"
    },
    {
        "menuCode": "menu_role_permission",
        "menuNameEn": "Role Permission",
        "menuNameCn": "角色权限管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 3,
        "path": "/manager/org/permissionGroup"
    },
    {
        "menuCode": "menu_asset_catalog",
        "menuNameEn": "Asset Catalog",
        "menuNameCn": "资产目录管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 4,
        "path": "/manager/business/field"
    },
    {
        "menuCode": "menu_param_config",
        "menuNameEn": "Parameter Config",
        "menuNameCn": "参数配置管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 5,
        "path": "/manager/systemParams/system"
    },
    {
        "menuCode": "menu_model_config",
        "menuNameEn": "Model Config",
        "menuNameCn": "模型配置管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 6,
        "path": "/manager/systemParams/modal"
    },
    {
        "menuCode": "menu_sandbox_config",
        "menuNameEn": "Sandbox Config",
        "menuNameCn": "沙箱配置管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 7,
        "path": "/manager/systemParams/sandbox"
    },
    {
        "menuCode": "menu_ui_agent",
        "menuNameEn": "UI Agent Skills",
        "menuNameCn": "界面技能管理",
        "menuUrl": "https://10.10.24.95:18082/skill-studio?uuid=a5wuyo&objectId=10000376&resourceCode=BYAI_DIG_EMPLOYEE_10000376&sessionId=&files=JTVCJTVE&language=zh-CN&session=main&token=${Beyond-token}",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 8,
        "path": ""
    }
]', '企业后台菜单管理');

delete from byai.byai_system_config where param_code in('DIG_EMPLOYEE_FILE_UPLOAD_CONFIG');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (10863540, 'text', 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG', '数字员工文件上传全局配置', 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG', '{
    "enabled": true,
    "allowedFileTypes": [".docx", ".doc", ".pdf", ".txt", ".md", ".xlsx", ".xls", ".csv", ".pptx", ".ppt", ".png", ".jpeg", ".jpg",".mp4", ".mov",".html", ".zip", ".gz", ".json", ".wav"],
    "maxFileSize": 100,
    "maxFileCount": 5
}', '数字员工文件上传全局配置');

delete from byai.byai_system_config where param_code in('TEMPLATE_DIGITAL_EMPLOYEE');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (10028461, 'text', 'TEMPLATE_DIGITAL_EMPLOYEE', '数字员工提示词模版', 'TEMPLATE_DIGITAL_EMPLOYEE', '[
  {
    "name": "个人助理",
    "key": "BYCLAW_ASSISTANT",
    "ownerType": "personal",
    "agentType": "001",
    "relTools": ["*"],
    "relSkills": ["dws"],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      },
      {
        "name": "人格定义",
        "key": "soul",
        "enName": "Personality Definition",
        "defaultValue": ""
      },
      {
        "name": "工具规范",
        "key": "tools",
        "enName": "Tool Specification",
        "defaultValue": ""
      },
      {
        "name": "记忆规范",
        "key": "memory",
        "enName": "Memory Specification",
        "defaultValue": ""
      }
    ]
  },
  {
    "name": "助手",
    "key": "BYCLAW_EXE",
    "ownerType": "enterprise",
    "agentType": "001",
    "relTools": ["*"],
    "relSkills": [],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      },
      {
        "name": "人格定义",
        "key": "soul",
        "enName": "",
        "defaultValue": ""
      },
      {
        "name": "工具规范",
        "key": "tools",
        "enName": "Tool Specification",
        "defaultValue": ""
      },
      {
        "name": "记忆规范",
        "key": "memory",
        "enName": "Memory Specification",
        "defaultValue": ""
      }
    ]
  },
  {
    "name": "问答",
    "key": "BYCLAW_QA",
    "ownerType": "enterprise",
    "agentType": "006",
    "relTools": [],
    "relSkills": [],
    "skillPath": "/.ByKC/{userCode}/agent_{resourceId}/skills",
    "prompts": [
      {
        "name": "问题分解",
        "key": "questionDecompose",
        "enName": "Question Decomposition",
        "defaultValue": "将用户的自然语言问题拆解为一个或多个独立的子查询，并标注每个子查询的推理跳数（hop count），用于后续并行调度检索。"
      },
      {
        "name": "单跳问题处理",
        "key": "singleHop",
        "enName": "Single Hop Processing",
        "defaultValue": "指导单跳检索代理通过多轮检索收集充分证据，生成有据可查且无引用标记的自然语言回答。"
      },
      {
        "name": "多跳问题信息检索",
        "key": "multiHopSearch",
        "enName": "Multi-hop Search",
        "defaultValue": "指导多跳检索代理逐跳推理、逐跳检索，通过调用 next_hop 或 finalize 链接各步结论，最终完成链式问答。"
      },
      {
        "name": "多跳问题回答",
        "key": "multiHopSummary",
        "enName": "Multi-hop Summary",
        "defaultValue": "将多跳推理代理的逐跳结果（子问题、证据、结论）合成为一份结构完整、证据可追溯的最终报告。"
      },
      {
        "name": "复合问题回答",
        "key": "subanswerAggregator",
        "enName": "Composite Answer Aggregation",
        "defaultValue": "将多个子查询的回答整合为一份逻辑连贯、无引用标记的 Markdown 格式综合回答，直接回应用户的原始问题。"
      }
    ]
  },
  {
    "name": "问数",
    "key": "BYCLAW_DATA",
    "ownerType": "enterprise",
    "agentType": "005",
    "relTools": [],
    "relSkills": [],
    "skillPath": "/.ByDC/{userCode}/agent_{resourceId}/skills",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": "请依据已有的工具进行数据查询、数据分析、数据操作。"
      }
    ]
  },
  {
    "name": "调试",
    "key": "BYCLAW_DEBUG",
    "ownerType": "enterprise",
    "agentType": "010",
    "relTools": [],
    "relSkills": [],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      }
    ]
  },
  {
    "name": "编码",
    "key": "BYCLAW_CODE",
    "ownerType": "enterprise",
    "agentType": "011",
    "relTools": [],
    "relSkills": [],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      }
    ]
  }
]', '数字员工提示词模版');


UPDATE "byai"."sandbox_service_spec" SET "spec_json" = '{
    "env": {
        "TZ": "Asia/Shanghai",
        "LANG": "zh_CN",
        "MODEL_ID": "${MODEL_ID}",
        "NODE_ENV": "production",
        "USER_CODE": "${user_code}",
        "MODEL_NAME": "${MODEL_NAME}",
        "REDIS_HOST": "${REDIS_HOST}",
        "REDIS_PORT": "${REDIS_PORT}",
        "DEMO_SCHEMA": "${DEMO_SCHEMA}",
        "MODEL_ALIAS": "${MODEL_ALIAS}",
        "OPENCLAW_TZ": "Asia/Shanghai",
        "BEYOND_TOKEN": "${BEYOND_TOKEN}",
        "NODE_OPTIONS": "--diagnostic-dir=/by/node-diagnostics --heapsnapshot-signal=SIGUSR2 --heapsnapshot-near-heap-limit=3 --heap-prof --heap-prof-dir=/by/node-diagnostics --max-old-space-size=512",
        "BE_DOMAINNAME": "ByaiService",
        "MODEL_API_KEY": "${MODEL_API_KEY}",
        "DWS_CONFIG_DIR": "/by/.openclaw/.dws",
        "MODEL_BASE_URL": "${MODEL_BASE_URL}",
        "REDIS_DATABASE": "${REDIS_DATABASE}",
        "REDIS_PASSWORD": "${REDIS_PASSWORD}",
        "REDIS_USERNAME": "${REDIS_USERNAME}",
        "BAIYING_SESSION": "${BAIYING_SESSION}",
        "DATACLOUD_DB_HOST": "${DB_HOST}",
        "DATACLOUD_DB_PASS": "${DB_PASS}",
        "DATACLOUD_DB_PORT": "${DB_PORT}",
        "DATACLOUD_DB_TYPE": "${DB_TYPE}",
        "DATACLOUD_DB_USER": "${DB_USER}",
        "BAIYING_AGENT_AUTH": "${BAIYING_AGENT_AUTH}",
        "OPENCLAW_STATE_DIR": "/by/.openclaw",
        "DATACLOUD_DB_SCHEMA": "${DB_SCHEMA}",
        "DATACLOUD_DB_DATABASE": "${DB_DATABASE}",
        "DATACLOUD_DB_PASSWORD": "${DB_PASS}",
        "OPENCLAW_GATEWAY_TOKEN": "${OPENCLAW_GATEWAY_TOKEN}",
        "FILE_STORAGE_MINIO_MOUNT_PATH": "${FILE_STORAGE_MINIO_MOUNT_PATH}"
    },
    "image": "10.10.165.101:8080/byclaw/byclaw-openclaw:develop",
    "ports": [
        {
            "port": 8080,
            "protocol": "http"
        },
        {
            "port": 8082,
            "instance": "filebrowser",
            "protocol": "http"
        }
    ],
    "startup": {
        "entrypoint": [
            "sh",
            "-lc",
            "mkdir -p /by/node-diagnostics && chmod 1777 /by/node-diagnostics && node dist/index.js gateway --bind=lan --port=8080 --allow-unconfigured --verbose & filebrowser --root /by/.openclaw --port 8082 --address 0.0.0.0 --noauth --baseurl /filebrowser"
        ]
    },
    "timeout": 3600,
    "volumes": [
        {
            "key": "base",
            "scope": "PRIVATE",
            "subPath": "byclaw-${user_code}/by",
            "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}",
            "readOnly": false,
            "mountPath": "/by"
        }
    ],
    "bootstrap": {
        "copyTemplate": {
            "copyIfMissing": true,
            "targetVolumeKey": "base"
        }
    },
    "sandboxType": "byclaw",
    "servicePort": 8080,
    "resourceLimits": {
        "cpu": "1",
        "memory": "2048Mi"
    }
}',
"template_json" = '{
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
                "skills": [],
                "default": true,
                "workspace": "${OPENCLAW_STATE_DIR}/workspace"
            }
        ],
        "defaults": {
            "model": {
                "primary": "byclaw/${MODEL_ID} "
            },
            "models": {
                "byclaw/model": {
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
            "thinkingDefault": "high",
            "blockStreamingBreak": "text_end",
            "blockStreamingDefault": "on"
        }
    },
    "models": {
        "providers": {
            "byclaw": {
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
}', "updated_at" = '2026-06-01 17:59:03.636' WHERE "service_key" = 'openclaw';
