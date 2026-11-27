我與Gemini對話  https://share.gemini.google/kLSid4KiIUeg

## 本書由opencode、Gemini協作完成

# 徹底搞懂 AI Agent：從 LLM API 到自主代理人的建構指南

欄位 | 內容
-----|--------
作業 | 12 — 自主學習技術書
寫作日期 | 2026-11-27
目標讀者 | 技術決策者（架構導向）
---

## 這本書在回答什麼

LLM API 只會「回一段文字」；Agent 卻能「完成一件任務」。中間差的不是更大的模型，而是**一層由工程師設計的流程控制**。

本書把這層流程拆成可理解的元件：API → 迴圈 → 工具 → 記憶 → 規劃 → 多代理人 → 防護，並用一個完整的 Python 範例（`demo_agent.py`）把所有觀念落地。

> 閱讀定位：這不是框架教學，也不是 Prompt 技巧錦集。它是一本**架構判讀指南**——讀完你應該能判斷「這個需求需不需要 Agent、需要哪幾個支柱、風險在哪裡」。

---

## 目錄

### 前言 (Introduction)
- [0.1 為什麼我們需要從 API 走向 Agent？](00-introduction.md#01-為什麼我們需要從-api-走向-agent)
- [0.2 本書架構與「對話-程式-寫書」學習循環說明](00-introduction.md#02-本書架構與對話-程式-寫書學習循環說明)

### 核心篇：基礎觀念演進

#### [第一章：無狀態的 LLM API (Stateless Completions)](01-stateless-llm-api.md)
- 1.1 大語言模型 (LLM) 的本質：文字接龍與 Token 預測
- 1.2 什麼是 API？以 Python 發送 HTTP Request / JSON Payload
- 1.3 LLM API 的天花板：無記憶、無實時資料、無法影響真實世界

#### [第二章：賦予 AI「大腦迴圈」—— ReAct 架構](02-react-architecture.md)
- 2.1 什麼是 ReAct？Reasoning (思考) + Acting (行動)
- 2.2 ReAct 的三大核心步驟：Thought → Action → Observation
- 2.3 零框架實現：如何用 System Prompt 引導模型遵循固定格式

#### [第三章：工具呼叫 (Function Calling / Tool Use)](03-function-calling.md)
- 3.1 讓 LLM 擁有雙手：將 Python Function 抽象化為工具描述
- 3.2 結構化輸出：JSON Schema 的定義與解析
- 3.3 實作安全邊界：工具執行的權限控管與錯誤捕捉

### 實踐篇：系統元件與程式實作

#### [第四章：Agent 的四大支柱 (Architectural Pillars)](04-architectural-pillars.md)
- 4.1 **LLM Core (大腦)**：模型選擇與 Prompt Engineering
- 4.2 **Planning (規劃)**：任務拆解、Sub-goals 與 Reflection (自我反思)
- 4.3 **Memory (記憶)**：短期記憶與長期記憶 (RAG)
- 4.4 **Tools (工具箱)**：Web Search、Code Interpreter、Custom APIs

#### [第五章：手寫第一個 ReAct Agent (Minimal Viable Agent)](05-minimal-react-agent.md)
- 5.1 專案結構與環境設定 (`demo_agent.py`)
- 5.2 實作 LLM 對話通訊與歷史紀錄維持
- 5.3 正規表達式 (Regex) 解析 `Action: tool_name(arg)`
- 5.4 閉環控制迴圈 (Closed-Loop Loop) 測試與除錯

### 進階篇：現代 Agent 框架與展望

#### [第六章：主流 Agent 框架與多 Agent 協作 (Multi-Agent Systems)](06-frameworks-and-multi-agent.md)
- 6.1 為什麼需要框架？LangGraph、CrewAI 與 AutoGen 比較
- 6.2 狀態機 (State Machine) 在 Agent 流程控制中的應用
- 6.3 多 Agent 協作模式：分工、討論與評估者機制 (Evaluator-Optimizer)

#### [第七章：結語與未來展望](07-conclusion.md)
- 7.1 從聊天機器人到 AI 軟體工程師 (如 OpenCode / Devin)
- 7.2 資訊安全與 AI Guardrails：防範 Prompt Injection 與非預期行動
- 7.3 本次自主學習心得與反思

### 附錄 (Appendix)
- [附錄 A：ReAct Agent 完整 Python 原始碼](demo_agent.py)
- [附錄 B：與 AI 對話探索過程](conversation_log.md)

---

## 建議閱讀路線

| 你的目的 | 建議順序 |
|---------|---------|
| 快速建立整體地圖 | 前言 → 第四章 → 第六章 → 第七章 |
| 想親手寫出一個 Agent | 第一章 → 第二章 → 第三章 → 第五章 → 附錄 A |
| 評估要不要導入 Agent | 第一章 → 第四章 → 第六章 → 7.2 → 7.3 |
| 準備口試 / 報告 | README → 各章「給決策者的重點」區塊 → 第七章 |

每章都有一段 **「給決策者的重點」**，放在章末，方便只讀結論。

---

## 先備知識

只需要會讀 Python 函式與 dict、知道 HTTP 是什麼。JSON、regex、JSON Schema、embedding 等在首次出現時都附了例子或示意圖；不需要先學過任何 Agent 框架。

---

## 如何使用這本書

1. **讀**：先看架構圖與表格，建立心智模型。
2. **跑**：先進入 `12/` 目錄，執行 `python demo_agent.py --mock`，不需要 API Key 就能看完整迴圈。
3. **改**：換掉工具、改 Prompt、調整最大步數，觀察行為如何變化。
4. **寫回**：把你的觀察記在[附錄 B](conversation_log.md) 或自己的筆記中，形成「對話 → 程式 → 寫書」的循環。

> 請在 `12/` 目錄下執行指令；若從上一層目錄執行，請改用 `python 12/demo_agent.py --mock`。
