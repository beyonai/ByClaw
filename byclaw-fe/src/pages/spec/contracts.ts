// 集成测试契约常量:平台按此约定读结果,脚本/用例集按此约定写产物。
// 规范页与「新增用例集 / 关联环境」弹框共用这一份,避免两处文案漂移。
// 端到端测试"结果目录与状态"契约:展示给写脚本的人看,平台按此约定读状态,脚本按此约定写状态。
// 平台通过环境变量把本次运行的结果根目录注入构建机/用例工程,脚本产物必须落在该目录下的约定结构里。
export const E2E_RESULT_DIR_TREE = `$BYCLAW_E2E_RESULT_DIR/        # 平台注入的本次运行结果根目录(分支+轮次唯一)
├── status.json      # 状态真相源:状态 + 汇总 + 失败明细(最后原子写入)
├── reports/         # 各用例集产出的 JUnit XML(明细,判断哪条用例挂了)
│   └── <suiteId>.xml
├── logs/            # 拉码/构建/部署/各套件运行日志
│   └── <suiteId>.log
└── artifacts/       # 失败证据(E2E 必备:截图/录屏/trace)
    └── <suiteId>/           # 按套件分目录,避免多套件文件重名打架
        ├── <caseId>.png     # 截图:文件名 = 用例ID,平台按名挂到失败用例
        ├── <caseId>.webm    # 录屏(可选)
        └── <caseId>.zip     # Playwright trace(可选)`;

export const E2E_STATUS_JSON = `{
  "schemaVersion": 1,
  "status": "running",          // 见下方状态枚举(封闭取值)
  "startedAt":  "2026-07-27T09:30:00+08:00",
  "updatedAt":  "2026-07-27T09:41:12+08:00",  // 可选:运行中定期刷新,便于人工查看进度
  "finishedAt": null,           // 仅终态非空
  "totals": { "total": 18, "passed": 15, "failed": 3, "skipped": 0 },
  "suites": [
    { "id": "suite-api", "status": "passed",  "report": "reports/suite-api.xml" },
    { "id": "suite-web", "status": "failed",  "report": "reports/suite-web.xml",
      "failedCases": [                        // 编排层解析 XML+artifacts 后回填,失败用例带截图
        { "case": "test_login", "artifacts": ["artifacts/suite-web/test_login.png"] }
      ] }
  ],
  "reason": "登录用例 3 条失败:跨模块调用鉴权头丢失"  // 打回原因,非失败可为空
}`;

export const E2E_SCRIPT_SKELETON = `#!/usr/bin/env bash
set -euo pipefail
DIR="$BYCLAW_E2E_RESULT_DIR"
mkdir -p "$DIR/reports" "$DIR/logs" "$DIR/artifacts"

# 原子写状态:先写临时文件再 rename,读者永远读不到半截 JSON
write_status() { echo "$1" > "$DIR/status.json.tmp" && mv "$DIR/status.json.tmp" "$DIR/status.json"; }

write_status '{"schemaVersion":1,"status":"running","startedAt":"'"$(date -Is)"'"}'

# 业务测试账号由编排层按「环境」里配的账号注入成环境变量,用例直接读,不落明文:
#   登录 "$E2E_ADMIN_USER" / "$E2E_ADMIN_PASS"   (前缀 = 环境配置里的 envPrefix)

# 运行用例集,产出 JUnit XML 到 reports/
if pytest -q --junitxml="$DIR/reports/suite-api.xml" | tee "$DIR/logs/suite-api.log"; then
  write_status '{"schemaVersion":1,"status":"passed","finishedAt":"'"$(date -Is)"'"}'
else
  # 用例失败 -> failed(打回 coder);若是构建/环境错误未跑到用例 -> error
  write_status '{"schemaVersion":1,"status":"failed","finishedAt":"'"$(date -Is)"'","reason":"用例失败"}'
fi`;

// 单套件契约:用例集作者只需保证自己这份产物的落点与退出码,整轮 status.json 由编排层汇总。
export const E2E_SUITE_CONTRACT = `# 用例集作者只需保证四件事,整轮状态由编排层汇总,无需自己写 status.json:

# 1) JUnit XML 报告(平台读它汇总通过率,判断哪条用例挂了)
#    产到运行命令里指定的报告路径,平台会收集到 $BYCLAW_E2E_RESULT_DIR/reports/<suiteId>.xml
pytest -q --junitxml=report/junit.xml

# 2) 退出码语义(平台据此判定本套件成败)
#    0     = 全部通过
#    非 0  = 有失败 / 运行错误

# 3) 标准输出即日志,平台收集到 $BYCLAW_E2E_RESULT_DIR/logs/<suiteId>.log

# 4) 失败证据(E2E 建议对失败用例必留截图):放当前工程约定目录,平台归集到 artifacts/<suiteId>/
#    命名 = 用例ID(如 test_login.png),平台按文件名把截图挂到 JUnit 里对应的失败用例。
#    - Playwright: use: { screenshot:'only-on-failure', video:'retain-on-failure', trace:'retain-on-failure' }
#    - pytest+selenium: 失败钩子里 driver.save_screenshot(f"artifacts/{case_id}.png")
#    (进阶)也可在 JUnit 用 [[ATTACHMENT|artifacts/<suiteId>/<caseId>.png]] 显式声明附件路径`;

// status.json 的 status 封闭枚举:平台据此判断"没开始/准备中/测试中/通过/失败/错误/超时/取消"。
export const E2E_STATUS_ENUM: Array<{ code: string; meaning: string }> = [
  { code: 'pending', meaning: '未开始(或 status.json 尚不存在)' },
  { code: 'preparing', meaning: '准备中:拉码 / 构建镜像 / 部署' },
  { code: 'running', meaning: '测试进行中(finishedAt 为 null;超过平台最大时长仍无终态则判 timeout)' },
  { code: 'passed', meaning: '全部通过 → 进入「提交 PR」' },
  { code: 'failed', meaning: '有用例失败 → 打回「编码」环节' },
  { code: 'error', meaning: '构建/部署/环境错误,未跑到用例 → 打回编码或运维介入' },
  { code: 'timeout', meaning: '超过最大时长被终止' },
  { code: 'cancelled', meaning: '人工取消' },
];

// 规范页路由。全平台一份:status.json 契约由平台硬编码读取,项目改不了,
// 做成项目级会误导用户以为能改。深链锚点用下面的 SECTION id。
export const E2E_SPEC_PATH = '/spec/integrationTest';

// 章节锚点:弹框深链直接跳到对应段落,不让用户在长页里找。
export const E2E_SPEC_SECTIONS = {
  roles: 'roles',
  demo: 'demo',
  suite: 'suite',
  orchestrator: 'orchestrator',
} as const;

// demo 工程下载:规范的最佳载体是可运行的参考实现,而不是让人从零照文档搭。
// zip 放 public/download/e2e-demo/,取法与资源导入模板一致(getRuntimeActualUrl)。
export const E2E_DEMO_DIR = '/download/e2e-demo';

export type E2eDemoKind = 'suite' | 'orchestrator';

export const E2E_DEMOS: Array<{ kind: E2eDemoKind; fileName: string }> = [
  { kind: 'suite', fileName: 'byclaw-e2e-suite-demo.zip' },
  { kind: 'orchestrator', fileName: 'byclaw-e2e-orchestrator-demo.zip' },
];

// 弹框现场只放「违反即坏」的最小契约,细节走规范页深链(progressive disclosure)。
// key 用于 i18n:projectSpace.detail.integration.suiteSpec.rule.<key>
export const E2E_SUITE_HARD_RULES = ['report', 'exitCode', 'artifact'] as const;

// 编排层同理:原子写、failed 与 error 分开、异常也要留终态。
// key 用于 i18n:projectSpace.detail.integration.spec.rule.<key>
export const E2E_RUN_HARD_RULES = ['atomic', 'failedVsError', 'terminal'] as const;
