import argparse
import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Callable

BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
MODEL = os.environ.get("MODEL", "gpt-4o-mini")
MAX_STEPS = 8

SYSTEM_PROMPT = """你是一個會使用工具的助理。每次回覆只能包含一段 Thought，加上一個 Action 或一個 Final Answer。

格式：
Thought: <一行推理>
Action: <tool_name>(<key>="<value>", ...)

若資訊已足夠，改用：
Thought: <一行推理>
Final Answer: <給使用者的答案>

可用工具：
- get_weather(city, date)：查詢城市與日期的天氣，回傳降雨機率與氣溫。
- search(query)：搜尋關鍵字，回傳相關結果清單。
- calculator(expr)：計算兩數加減乘除，例如 3*7。

規則：
1. 一次只能有一個 Action。
2. 不要自己編造 Observation，系統會提供。
3. 若 Observation 顯示錯誤，請換工具或換參數再試。
4. 若已經能回答使用者，就輸出 Final Answer。"""

ACTION_RE = re.compile(r"Action:\s*([A-Za-z_]\w*)\s*\(([^)]*)\)", re.S)
ARG_RE = re.compile(r"([A-Za-z_]\w*)\s*=\s*\"([^\"]*)\"")
FINAL_RE = re.compile(r"Final Answer:\s*(.*)", re.S)

MOCK_TURNS = [
    'Thought: 需要先知道明天台北的天氣，才能判斷是否適合戶外活動。\n'
    'Action: get_weather(city="台北", date="明天")',
    'Thought: 降雨機率 80%，不適合戶外；我該找室內備案。\n'
    'Action: search(query="台北 室內 活動 場地")',
    'Thought: 已有天氣與室內備案，可以下結論了。\n'
    'Final Answer: 明天台北降雨機率 80%、氣溫 22°C，不建議戶外活動；'
    '可改到科教館、華山藝文中心或市立美術館。',
]


def get_weather(city: str, date: str) -> dict[str, Any]:
    data = {
        ("台北", "明天"): {"city": city, "date": date, "rain_prob": 0.8, "temp": 22},
        ("高雄", "明天"): {"city": city, "date": date, "rain_prob": 0.2, "temp": 30},
    }
    return data.get(
        (city, date),
        {"ok": False, "error": f"查無 {city} / {date} 的天氣資料，試試台北或高雄。"},
    )


def search(query: str) -> dict[str, Any]:
    results = {
        "台北 室內 活動 場地": ["科教館", "華山藝文中心", "市立美術館"],
    }
    found = results.get(query)
    if found is None:
        return {"ok": False, "error": f"找不到與「{query}」相關的結果。"}
    return {"query": query, "results": found}


def calculator(expr: str) -> dict[str, Any]:
    match = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)\s*", expr)
    if match is None:
        return {"ok": False, "error": "只支援兩數運算，例如 3*7。"}
    left = float(match.group(1))
    op = match.group(2)
    right = float(match.group(3))
    if op == "/":
        if right == 0:
            return {"ok": False, "error": "除數不能為零。"}
        value = left / right
    elif op == "+":
        value = left + right
    elif op == "-":
        value = left - right
    else:
        value = left * right
    return {"expr": expr, "result": value}


TOOLS: dict[str, Callable[..., dict[str, Any]]] = {
    "get_weather": get_weather,
    "search": search,
    "calculator": calculator,
}


def execute_tool(name: str, args: dict[str, str]) -> dict[str, Any]:
    if name not in TOOLS:
        allowed = ", ".join(TOOLS)
        return {"ok": False, "error": f"工具 {name} 不存在。可用工具：{allowed}。"}
    try:
        return TOOLS[name](**args)
    except TypeError as exc:
        return {"ok": False, "error": f"參數錯誤：{exc}"}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def parse_action(text: str) -> tuple[str, dict[str, str]] | None:
    match = ACTION_RE.search(text)
    if match is None:
        return None
    args = {key: value for key, value in ARG_RE.findall(match.group(2))}
    return match.group(1), args


def call_llm(messages: list[dict[str, str]]) -> str:
    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 800,
    }
    request = urllib.request.Request(
        BASE_URL + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + os.environ["OPENAI_API_KEY"],
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM API 回傳 HTTP {exc.code}: {detail[:300]}") from exc
    return body["choices"][0]["message"]["content"]


def call_llm_mock(messages: list[dict[str, str]]) -> str:
    used = sum(1 for message in messages if message["role"] == "assistant")
    index = min(used, len(MOCK_TURNS) - 1)
    return MOCK_TURNS[index]


def run(question: str, use_mock: bool) -> None:
    messages: list[dict[str, str]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    print(f"任務：{question}")
    print(f"模式：{'mock' if use_mock else MODEL}    最大步數：{MAX_STEPS}")

    for step in range(1, MAX_STEPS + 1):
        response = call_llm_mock(messages) if use_mock else call_llm(messages)
        print(f"\n[Step {step}] LLM")
        print(response.strip())
        messages.append({"role": "assistant", "content": response})

        final = FINAL_RE.search(response)
        if final is not None:
            print("\n=== 最終答案 ===")
            print(final.group(1).strip())
            return

        parsed = parse_action(response)
        if parsed is None:
            observation = {
                "ok": False,
                "error": "找不到 Action 或 Final Answer，請依照格式回覆。",
            }
        else:
            name, args = parsed
            observation = execute_tool(name, args)

        observation_text = json.dumps(observation, ensure_ascii=False)
        print(f"[Observation] {observation_text}")
        messages.append({"role": "user", "content": "Observation: " + observation_text})

    print("\n[停止] 已達最大步數。請縮小任務、調整 Prompt，或提高 MAX_STEPS。")


def main() -> None:
    parser = argparse.ArgumentParser(description="零框架 ReAct Agent 範例")
    parser.add_argument("--question", default="明天台北適合辦戶外活動嗎？")
    parser.add_argument(
        "--mock",
        action="store_true",
        help="使用內建回應，不需要 API Key",
    )
    args = parser.parse_args()
    if not args.mock and not os.environ.get("OPENAI_API_KEY"):
        parser.error("請設定 OPENAI_API_KEY，或使用 --mock 模式。")
    run(args.question, args.mock)


if __name__ == "__main__":
    main()
