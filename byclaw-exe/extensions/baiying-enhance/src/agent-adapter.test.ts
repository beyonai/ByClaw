import { describe, expect, it } from "vitest";
import { adaptAgentJson, extractBaiyingPrologueModelId } from "./agent-adapter.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";

describe("adaptAgentJson", () => {
    it("extracts modelId from DIG_EMPLOYEE_10000281 prologue", () => {
        const raw = { prologue: JSON.stringify({ modelId: -2000 }) };
        expect(extractBaiyingPrologueModelId(raw)).toBe("-2000");
    });

    it("maps Baiying agent_list export", () => {
        const raw = {
            agent_list: [
                {
                    id: 10863047,
                    name: "Demo",
                    instructions: "Be brief.",
                    runConfig: {
                        baseUrl: "https://example.com/v1",
                        model: "qwen3-max",
                        apiKey: "test-key",
                    },
                },
            ],
        };
        const res = adaptAgentJson({
            raw,
            fileName: "demo.json",
            embedApiKeysFromJson: true,
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.agentId).toBe(`${MANAGED_AGENT_PREFIX}10863047`);
        expect(res.providerKey).toBe("");
        expect(res.modelRef).toBe("");
        expect(res.systemPrompt).toBe("Be brief.");
        expect(res.listEntry.model).toBeUndefined();
        expect(res.listEntry.experimental).toEqual({ localModelLean: false });
        expect(res.listEntry.skills).toEqual([]);
    });

    it("ignores native provider/model and keeps default-model fallback", () => {
        const raw = {
            id: "support",
            name: "Support",
            model: "openai/gpt-4o-mini",
            systemPrompt: "Help users.",
        };
        const res = adaptAgentJson({
            raw,
            fileName: "support.json",
            embedApiKeysFromJson: false,
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.agentId).toBe(`${MANAGED_AGENT_PREFIX}support`);
        expect(res.providerKey).toBe("");
        expect(res.modelRef).toBe("");
        expect(res.provider).toBeUndefined();
        expect(res.listEntry.model).toBeUndefined();
        expect(res.listEntry.experimental).toEqual({ localModelLean: false });
        expect(res.systemPrompt).toBe("Help users.");
        expect(res.listEntry.skills).toEqual([]);
    });

    it("does not embed JSON array corePersonaDefinition in systemPrompt", () => {
        const raw = {
            resourceId: "10001973",
            resourceName: "陈舵主的个人助理",
            resourceDesc: "助理",
            integrationType: "NONE",
            corePersonaDefinition: '[{"name":"拓展属性","key":"custom_1u1wa3","value":"拓展属性"}]',
            ability: "围绕个人知识库回答问题。",
            constraints: "优先依据知识库。",
        };
        const res = adaptAgentJson({
            raw,
            fileName: "DIG_EMPLOYEE_10001973.json",
            embedApiKeysFromJson: false,
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.systemPrompt).not.toContain('[{"name"');
        expect(res.systemPrompt).toContain("围绕个人知识库回答问题。");
        expect(res.systemPrompt).toContain("优先依据知识库。");
        expect(res.systemPrompt).toContain("BYAI_BUSINESS_EXTENSIONS.md");
    });

    it("prefers corePersonaDefinition in systemPrompt for raw Baiying detail", () => {
        const raw = {
            resourceId: "10000014",
            resourceName: "水果百科数字员工",
            resourceDesc: "水果百科",
            integrationType: "NONE",
            corePersonaDefinition: "你是果百科专家，说话简短。",
            roleAttributes: "配角说明（应在人格之后作为补充出现）。",
        };
        const res = adaptAgentJson({
            raw,
            fileName: "DIG_EMPLOYEE_10000014.json",
            embedApiKeysFromJson: false,
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.systemPrompt).toMatch(/^你是果百科专家/);
        expect(res.systemPrompt).toContain("配角说明");
    });

    it("maps raw Baiying detail (integrationType NONE)", () => {
        const raw = {
            resourceId: "10024099",
            resourceName: "IT助手智能体",
            resourceDesc: "An IT helper agent",
            integrationType: "NONE",
            roleAttributes: "You are an IT support assistant.",
            processingFlow: "Answer IT questions step by step.",
            prologue: JSON.stringify({
                modelInfo: { model: "qwen3-max", temperature: 0.7 },
                descText: "Hello, I am your IT helper.",
                openingQuestion: '["How to reset password?","VPN setup"]',
            }),
            coreCompetencies: JSON.stringify([
                { coreCompetency: "Password Reset", description: "Help reset passwords" },
            ]),
            relResourceList: [
                {
                    resourceId: "doc-001",
                    resourceName: "IT FAQ",
                    resourceBizType: "KG_DOC",
                    resourceType: "DOC",
                    implType: "KNOWLEDGE_BASE",
                    resourceCode: "faq_dataset",
                    resourceDesc: "FAQ knowledge base",
                    resourceSourcePkId: "dataset-001",
                    systemCode: "BYAI",
                    hostType: "hosted",
                    parentResourceId: "-1",
                },
            ],
        };
        const res = adaptAgentJson({
            raw,
            fileName: "it-helper.json",
            embedApiKeysFromJson: false,
            defaultProxyUrl: "https://proxy.example.com/v1",
            defaultApiKey: "sk-test",
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.agentId).toBe(`${MANAGED_AGENT_PREFIX}10024099`);
        expect(res.sourceKey).toBe("10024099");
        expect(res.providerKey).toBe("");
        expect(res.modelRef).toBe("");
        expect(res.provider).toBeUndefined();
        expect(res.systemPrompt).toContain("IT support assistant");
        expect(res.systemPrompt).toContain("Answer IT questions step by step.");
        expect(res.integrationType).toBe("NONE");
        expect(res.agentSseUrl).toBeUndefined();
        expect(res.associatedResources).toHaveLength(1);
        expect(res.associatedResources![0].resourceId).toBe("doc-001");
        expect(res.associatedResources![0].resourceName).toBe("IT FAQ");
        expect(res.associatedResources![0].resourceBizType).toBe("KG_DOC");
        expect(res.associatedResources![0].implType).toBe("KNOWLEDGE_BASE");
        expect(res.associatedResources![0].resourceCode).toBe("faq_dataset");
        expect(res.associatedResources![0].resourceSourcePkId).toBe("dataset-001");
        expect(res.associatedResources![0].systemCode).toBe("BYAI");
        expect(res.associatedResources![0].hostType).toBe("hosted");
        expect(res.associatedResources![0].parentResourceId).toBe("-1");
        expect(res.coreCompetencies).toHaveLength(1);
        expect(res.coreCompetencies![0].coreCompetency).toBe("Password Reset");
        expect(res.listEntry.skills).toEqual([]);
        expect(res.baiyingModelId).toBeUndefined();
    });

    it("uses relResourceList for associated resources", () => {
        const raw = {
            resourceId: "10039008",
            resourceName: "Ontology helper",
            relResourceList: [
                {
                    resourceId: "10000045",
                    resourceName: "销售管理视图",
                    resourceBizType: "VIEW",
                    resourceCode: "scene_sales_management",
                    resourceDesc: "销售漏斗视图",
                },
            ],
        };
        const res = adaptAgentJson({
            raw,
            fileName: "DIG_EMPLOYEE_10039008.json",
            embedApiKeysFromJson: false,
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.associatedResources).toHaveLength(1);
        expect(res.associatedResources![0]).toMatchObject({
            resourceId: "10000045",
            resourceName: "销售管理视图",
            resourceBizType: "VIEW",
            resourceCode: "scene_sales_management",
            resourceDesc: "销售漏斗视图",
        });
    });

    it("smoke: DIG_EMPLOYEE_10000115.json maps relSkills to agents.list skills", () => {
        const raw = {
            resourceId: "10000115",
            resourceName: "Skill Demo",
            relSkills: ["dws", "clawhub"],
        };
        const res = adaptAgentJson({
            raw,
            fileName: "DIG_EMPLOYEE_10000115.json",
            embedApiKeysFromJson: false,
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.agentId).toBe(`${MANAGED_AGENT_PREFIX}10000115`);
        expect(res.listEntry.skills).toEqual(["dws", "clawhub"]);
    });

    it("maps object-form relSkills and retains hub sync metadata", () => {
        const raw = {
            resourceId: "10026037",
            resourceName: "Hub Skill Demo",
            relSkills: [
                { skillCode: "dws", skillType: "inner" },
                {
                    skillCode: "guizang-ppt-skill-main",
                    skillType: "hub",
                    skillUrl: "/byaiService/tool/downloadSkillZip?skillId=10026639",
                    versionUrl: "/byaiService/tool/getSkillVersion?skillId=10026639",
                },
            ],
        };
        const res = adaptAgentJson({
            raw,
            fileName: "DIG_EMPLOYEE_10026037.json",
            embedApiKeysFromJson: false,
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.listEntry.skills).toEqual(["dws", "guizang-ppt-skill-main"]);
        expect(res.hubSkills).toEqual([
            {
                skillCode: "guizang-ppt-skill-main",
                skillUrl: "/byaiService/tool/downloadSkillZip?skillId=10026639",
                versionUrl: "/byaiService/tool/getSkillVersion?skillId=10026639",
            },
        ]);
    });

    it("keeps relSkills compatibility for mixed legacy strings and object refs", () => {
        const raw = {
            resourceId: "10026038",
            resourceName: "Mixed Skill Demo",
            relSkills: [
                " dws ",
                { skillCode: "dws", skillType: "inner" },
                {
                    skillCode: "hub-skill",
                    skillType: "hub",
                    skillUrl: "/byaiService/tool/downloadSkillZip?skillId=2",
                    versionUrl: "/byaiService/tool/getSkillVersion?skillId=2",
                },
                { skillCode: "inner-skill", skillType: "inner" },
                { skillCode: "", skillType: "inner" },
                null,
            ],
        };
        const res = adaptAgentJson({
            raw,
            fileName: "DIG_EMPLOYEE_10026038.json",
            embedApiKeysFromJson: false,
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.listEntry.skills).toEqual(["dws", "hub-skill", "inner-skill"]);
        expect(res.hubSkills).toEqual([
            {
                skillCode: "hub-skill",
                skillUrl: "/byaiService/tool/downloadSkillZip?skillId=2",
                versionUrl: "/byaiService/tool/getSkillVersion?skillId=2",
            },
        ]);
    });

    it("falls back to legacy skills when relSkills has no usable skill codes", () => {
        const raw = {
            resourceId: "10026040",
            resourceName: "Fallback Skill Demo",
            relSkills: [{ skillType: "inner" }, null, ""],
            skills: ["legacy-skill"],
        };
        const res = adaptAgentJson({
            raw,
            fileName: "DIG_EMPLOYEE_10026040.json",
            embedApiKeysFromJson: false,
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.listEntry.skills).toEqual(["legacy-skill"]);
        expect(res.hubSkills).toBeUndefined();
    });

    it("maps raw Baiying detail relTools to agents.list tools.allow", () => {
        const raw = {
            resourceId: "10011257",
            resourceName: "Tool limited employee",
            integrationType: "NONE",
            relTools: ["*", " read ", "", "write"],
        };
        const res = adaptAgentJson({
            raw,
            fileName: "DIG_EMPLOYEE_10011257.json",
            embedApiKeysFromJson: false,
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.listEntry.tools).toEqual({
            allow: ["*", "read", "write", "baiying_call"],
        });
        expect(res.listEntry.experimental).toEqual({ localModelLean: false });
    });

    it("maps raw Baiying detail (integrationType INTERFACE)", () => {
        const raw = {
            resourceId: "20001",
            resourceName: "Weather Bot",
            resourceDesc: "Query weather",
            integrationType: "INTERFACE",
            agentSseUrl: "https://sse.example.com/agent/20001",
            agentHomeUrl: "https://home.example.com/agent/20001",
            prologue: JSON.stringify({
                modelInfo: { model: "gpt-4o" },
            }),
        };
        const res = adaptAgentJson({
            raw,
            fileName: "weather.json",
            embedApiKeysFromJson: false,
            defaultProxyUrl: "https://proxy.example.com/v1",
        });
        expect("error" in res).toBe(false);
        if ("error" in res) {
            return;
        }
        expect(res.agentId).toBe(`${MANAGED_AGENT_PREFIX}20001`);
        expect(res.integrationType).toBe("INTERFACE");
        expect(res.agentSseUrl).toBe("https://sse.example.com/agent/20001");
        expect(res.agentHomeUrl).toBe("https://home.example.com/agent/20001");
    });

    it("does not require defaultProxyUrl for raw detail format", () => {
        const raw = {
            resourceId: "30001",
            resourceName: "Test Agent",
            prologue: JSON.stringify({ modelInfo: { model: "gpt-4o" } }),
        };
        const res = adaptAgentJson({
            raw,
            fileName: "test.json",
            embedApiKeysFromJson: false,
            // no defaultProxyUrl
        });
        expect("error" in res).toBe(false);
        if (!("error" in res)) {
            expect(res.provider).toBeUndefined();
            expect(res.listEntry.model).toBeUndefined();
        }
    });
});
