"""端到端测试: analyze_query_clarification 全流程。

从 byclaw-data 项目运行（有 .env 配置 LLM 和 DB）。

Run:
    uv run python test_e2e_clarification.py
"""

from __future__ import annotations

import json

from dotenv import load_dotenv

load_dotenv()

from datacloud_knowledge.intent import analyze_query_clarification  # noqa: E402

TEST_CASES = [
    "202602龙头、骨干、中坚企业的数量、营收、利润",
    "202602各街道的总营收、龙头企业营收、龙头占比",
    "帮我查一下亦庄区域高风险企业总数和龙头企业的企业缴税总数、收入均值",
]


def main() -> None:
    for query in TEST_CASES:
        print(f"\n{'='*80}")
        print(f"INPUT: {query}")
        print(f"{'─'*80}")
        try:
            result = analyze_query_clarification(query)
            print(f"query: {result.query}")
            print(f"needs_clarification: {result.needs_clarification}")
            if result.form:
                payload = json.loads(result.form)
                print(f"form paradigmList count: {len(payload.get('paradigmList', []))}")
                print(json.dumps(payload, ensure_ascii=False, indent=2))
            if result.knowledge:
                payload = json.loads(result.knowledge)
                print(f"knowledge paradigmList count: {len(payload.get('paradigmList', []))}")
                print(json.dumps(payload, ensure_ascii=False, indent=2))
            if not result.form and not result.knowledge:
                print("(passthrough - no form or knowledge)")
        except Exception as exc:
            print(f"ERROR: {exc}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    main()
