#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
qwen_tool_proxy.py  --  Qwen2.5 本地模型的 DeepSeek Harness(DSH)工具调用补丁(修复版)

背景
----
DSH 依赖 OpenAI 的 `tools` / `tool_calls` 协议驱动 Agent 操控电脑。
而 llama.cpp 服务的 Qwen2.5-Coder 模型既不能稳定遵循 OpenAI 的 tools 数组,
在小模型 + 大段工具 schema 时还极易"退化循环"(疯狂重复 type/false/JSON 碎片),
导致 DSH 收到一堆垃圾文本。

本程序就是补丁层: 监听一个端口, 把 OpenAI 格式请求转发给 llama-server,
对请求做"防退化/瘦身"(工具预算、抗退化采样、截断描述),
再把模型原生 `<tools>...</tools>` 输出改写为标准 `tool_calls`,
让 DSH 能真正驱动这个模型去操作电脑。

用法
----
    python qwen_tool_proxy.py                          # 默认监听 8081 -> 127.0.0.1:8080
    python qwen_tool_proxy.py --port 8081 --upstream http://127.0.0.1:8080 --max-tools 6

然后将 DSH 里该模型的 baseURL 指向  http://127.0.0.1:8081/v1  即可。
"""

import argparse
import json
import re
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

UPSTREAM_DEFAULT = "http://127.0.0.1:8080"
LISTEN_PORT_DEFAULT = 8081
# Qwen 的结束/分隔 token(用作 stop, 防止模型一路刷下去)
QWEN_STOPS = ["<|im_end|>", "<|im_start|>", "</tools>", "<tools>"]
# 描述/参数字段过长会撑爆小模型, 截断到该长度
DESC_MAX = 200
PARAM_DESC_MAX = 120


def _find_json(text):
    """从字符串里挖第一个 { 到与之配对的 } 之间的内容(返回原字符串)。"""
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        return None
    return text[start:end + 1]


def parse_tool_call(content):
    """
    从模型输出中提取工具调用, 返回 (name, arguments_json_string), 找不到返回 None。
    兼容 <tools>...</tools>、```json``` 围栏、以及 {name,arguments} / {function:{...}}。
    """
    if not content or not isinstance(content, str) or not content.strip():
        return None

    candidates = []
    m = re.search(r"<tools>\s*([\s\S]*?)\s*</tools>", content, re.IGNORECASE)
    if m:
        candidates.append(m.group(1))
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
    if m:
        candidates.append(m.group(1))
    candidates.append(_find_json(content))

    for c in candidates:
        if not c:
            continue
        body = _find_json(c)
        if not body:
            continue
        try:
            obj = json.loads(body)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue

        name = obj.get("name")
        args = obj.get("arguments")

        if name is None and isinstance(obj.get("function"), dict):
            fn = obj["function"]
            name = fn.get("name")
            args = fn.get("arguments", args)

        # 有些模型只输出 {参数:值} 而没带函数名, 无法确定调用谁, 跳过
        if not isinstance(name, str) or not name:
            continue

        if isinstance(args, (dict, list)):
            args = json.dumps(args, ensure_ascii=False)
        elif args is None:
            args = "{}"
        elif not isinstance(args, str):
            args = json.dumps(args, ensure_ascii=False)

        return name, args

    return None


def _trim_str(s, limit):
    return (s or "")[:limit]


def _trim_tools(tools, max_tools):
    """瘦身工具数组: 截断数量 + 缩短 description / 参数描述, 避免撑爆小模型。"""
    if not isinstance(tools, list):
        return tools
    out = []
    for t in tools[:max_tools]:
        try:
            t = json.loads(json.dumps(t))  # 深拷贝
        except Exception:
            continue
        fn = t.get("function") if isinstance(t, dict) else None
        if fn is None:
            # 兼容裸 function 结构
            fn = t if isinstance(t.get("name"), str) else None
        if fn is None:
            continue
        if isinstance(fn.get("description"), str):
            fn["description"] = _trim_str(fn["description"], DESC_MAX)
        params = fn.get("parameters")
        if isinstance(params, dict):
            props = params.get("properties")
            if isinstance(props, dict):
                for k, v in list(props.items()):
                    if isinstance(v, dict):
                        if isinstance(v.get("description"), str):
                            v["description"] = _trim_str(v["description"], PARAM_DESC_MAX)
                        props[k] = v
        if "name" in fn and isinstance(fn.get("name"), str):
            out.append({"type": "function", "function": fn})
    return out


def _looks_degenerate(content):
    """粗略判断是否退化循环(大量重复词 / 无有效工具调用且过长)。"""
    if not content or not isinstance(content, str):
        return False
    stripped = content.strip()
    if len(stripped) < 30:
        return False
    words = re.findall(r"[A-Za-z]{4,}", stripped.lower())
    if not words:
        return False
    total = len(words)
    top = max((words.count(w) for w in set(words)), default=0)
    if total >= 20 and top / total > 0.25:
        return True
    if len(stripped) > 600 and not stripped.rstrip().endswith(("<|im_end|>", "```", "}")):
        return True
    return False


class Handler(BaseHTTPRequestHandler):
    server_version = "QwenToolProxy/1.0"
    protocol_version = "HTTP/1.1"

    # 由 main() 写入
    UPSTREAM = UPSTREAM_DEFAULT
    MAX_TOOLS = 8
    REPEAT_PENALTY = 1.15

    def log_message(self, fmt, *args):
        pass

    def _forward(self, body):
        req = Request(
            self.UPSTREAM + self.path,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8")
                data = json.loads(raw)
                return resp.status, data
        except HTTPError as e:
            return e.code, {"error": {"message": e.read().decode("utf-8", "ignore"), "type": "upstream"}}
        except Exception as e:
            return 502, {"error": {"message": str(e), "type": "proxy"}}

    def do_GET(self):
        self._passthrough()

    def do_OPTIONS(self):
        self.send_response(204)
        self._common_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _build_upstream(self, body):
        upstream = dict(body)
        has_tools = bool(body.get("tools"))
        if has_tools:
            upstream["tools"] = _trim_tools(body["tools"], self.MAX_TOOLS)
            # 抗退化采样
            upstream.setdefault("repeat_penalty", self.REPEAT_PENALTY)
            upstream.setdefault("min_p", 0.05)
            if isinstance(upstream.get("temperature"), (int, float)) and upstream["temperature"] > 0.9:
                upstream["temperature"] = 0.9
            upstream.setdefault("top_p", 0.9)
            # 工具调用只需很短的输出, 收紧上限防刷屏
            upstream["max_tokens"] = min(int(upstream.get("max_tokens") or 1024), 512)
            stops = list(QWEN_STOPS)
            existing = upstream.get("stop")
            if isinstance(existing, list):
                stops.extend(existing)
            elif isinstance(existing, str):
                stops.append(existing)
            upstream["stop"] = stops
        upstream["stream"] = False
        return upstream

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        try:
            body = json.loads(raw) if raw else {}
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        is_chat = self.path.rstrip("/").endswith("/v1/chat/completions")
        if not is_chat:
            self._passthrough(build=False, body=body)
            return

        client_stream = bool(body.get("stream", False))
        has_tools = bool(body.get("tools"))

        upstream = self._build_upstream(body)
        status, data = self._forward(upstream)
        content = self._extract_content(data)
        parsed = parse_tool_call(content)

        # 若退化且带 tools: 用最小工具集 + 更强 repeat_penalty 重试一次
        if has_tools and not parsed and _looks_degenerate(content):
            retry_upstream = dict(upstream)
            retry_upstream["tools"] = _trim_tools(body["tools"], max(1, min(4, self.MAX_TOOLS)))
            retry_upstream["repeat_penalty"] = min(1.5, self.REPEAT_PENALTY + 0.2)
            retry_upstream["max_tokens"] = 240
            retry_status, retry_data = self._forward(retry_upstream)
            content = self._extract_content(retry_data)
            parsed = parse_tool_call(content)
            if retry_status == 200 and "choices" in retry_data:
                data = retry_data
                status = retry_status

        # 二次仍退化: 给 DSH 干净兜底文案, 而不是一堆垃圾
        if has_tools and not parsed and _looks_degenerate(content):
            self._write_json(
                200,
                self._clean_ok(data,
                               "工具调用生成失败(模型对工具列表过载, 已精简并做防退化重试)。"
                               "请减少该模型可用的工具/技能数量, 或换用更大的模型(如 Qwen2.5-Coder-32B)。"),
                client_stream,
            )
            return

        if status != 200 or "choices" not in data or not data["choices"]:
            self._write_json(status, data, client_stream)
            return

        choice = data["choices"][0]
        if parsed:
            name, args_str = parsed
            tool_call = {
                "id": "call_" + uuid.uuid4().hex[:16],
                "type": "function",
                "function": {"name": name, "arguments": args_str},
            }
            message = {"role": "assistant", "content": "", "tool_calls": [tool_call]}
            choice["message"] = message
            choice["finish_reason"] = "tool_calls"
            if "text" in choice:
                choice.pop("text")
            self._write_json(status, data, client_stream, toolcalls=True)
            return

        self._write_json(status, data, client_stream)

    def _extract_content(self, data):
        try:
            return (data["choices"][0].get("message") or {}).get("content") or ""
        except Exception:
            return ""

    def _clean_ok(self, data, msg):
        base = {
            "id": data.get("id", "chatcmpl-proxy"),
            "object": "chat.completion",
            "created": int(__import__("time").time()),
            "model": data.get("model", "qwen-local"),
            "choices": [{"index": 0, "message": {"role": "assistant", "content": msg}, "finish_reason": "stop"}],
        }
        if isinstance(data.get("usage"), dict):
            base["usage"] = data["usage"]
        return base

    def _passthrough(self, build=False, body=None):
        method = self.command
        data = None
        if body is not None:
            try:
                data = json.dumps(body).encode("utf-8")
            except Exception:
                data = None
        req = Request(self.UPSTREAM + self.path, data=data, method=method,
                      headers={"Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=60) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                self._common_headers()
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except HTTPError as e:
            payload = e.read()
            self.send_response(e.code)
            self._common_headers()
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception:
            self._write_json(502, {"error": {"message": "proxy passthrough failed", "type": "proxy"}}, False)

    def _common_headers(self):
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")

    def _write_json(self, status, obj, client_stream, toolcalls=False):
        if client_stream:
            self.send_response(status)
            self.send_header("Content-Type", "text/event-stream")
            self._cors()
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.close_connection = True
            self.end_headers()
            for chunk in self._to_sse(obj, toolcalls=toolcalls):
                self.wfile.write(chunk.encode("utf-8"))
                self.wfile.flush()
            return
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._common_headers()
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")

    def _to_sse(self, data, toolcalls=False):
        if "choices" not in data or not data["choices"]:
            yield "data: " + json.dumps(data, ensure_ascii=False) + "\n\n"
            yield "data: [DONE]\n\n"
            return
        choice = data["choices"][0]
        mid = data.get("id", "chatcmpl-proxy")
        model = data.get("model", "")
        yield _sse_chunk(mid, model, {"role": "assistant", "content": ""}, None)

        if toolcalls:
            tc = choice["message"]["tool_calls"][0]
            yield _sse_chunk(mid, model,
                             {"tool_calls": [{"index": 0, "id": tc["id"], "type": "function",
                                              "function": {"name": tc["function"]["name"], "arguments": ""}}]},
                             None)
            yield _sse_chunk(mid, model,
                             {"tool_calls": [{"index": 0, "function": {"arguments": tc["function"]["arguments"]}}]},
                             None)
            yield _sse_chunk(mid, model, {}, "tool_calls")
        else:
            content = choice["message"].get("content", "")
            if content:
                yield _sse_chunk(mid, model, {"content": content}, None)
            yield _sse_chunk(mid, model, {}, choice.get("finish_reason", "stop"))


def _sse_chunk(msg_id, model, delta, finish):
    chunk = {
        "id": msg_id,
        "object": "chat.completion.chunk",
        "created": int(__import__("time").time()),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    return "data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=LISTEN_PORT_DEFAULT)
    ap.add_argument("--upstream", default=UPSTREAM_DEFAULT)
    ap.add_argument("--max-tools", type=int, default=8, help="发给模型的最大工具数(小模型建议 4~8, 过大易退化)")
    ap.add_argument("--repeat-penalty", type=float, default=1.15, help="抗退化重复惩罚")
    args = ap.parse_args()

    Handler.UPSTREAM = args.upstream.rstrip("/")
    Handler.MAX_TOOLS = max(1, args.max_tools)
    Handler.REPEAT_PENALTY = args.repeat_penalty

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[qwen_tool_proxy] listening on http://127.0.0.1:{args.port}/v1  ->  upstream {args.upstream}")
    print(f"[qwen_tool_proxy] max-tools={Handler.MAX_TOOLS} repeat-penalty={Handler.REPEAT_PENALTY}")
    print(f"[qwen_tool_proxy] 把 DSH 里该模型的 baseURL 改为 http://127.0.0.1:{args.port}/v1 即可让本地模型驱动工具调用")
    srv.serve_forever()


if __name__ == "__main__":
    main()
