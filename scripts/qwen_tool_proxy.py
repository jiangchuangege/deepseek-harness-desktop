#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
qwen_tool_proxy.py  --  给 Qwen2.5-Coder 打“工具调用”补丁的转换层（二次开发成果）

背景
----
DSH（DeepSeek Harness）让 Agent 操控电脑，依赖 OpenAI 的 `tools` / `tool_calls` 协议。
而 llama.cpp 服务的 Qwen2.5-Coder 模型虽然【能】做工具调用，但用的是它原生格式：

        <tools>
        {"name": "xxx", "arguments": { ... }}
        </tools>

它不输出标准 `tool_calls`，所以 DSH 抓不到工具调用、也就无法执行命令/改文件。

本程序就是一个“补丁层”：它监听一个新端口，把 OpenAI 格式的请求转发给 llama-server，
再把模型原生输出的 `<tools>...</tools>` 识别出来，改写成标准 `tool_calls`，
这样 DSH（以及任何 OpenAI 客户端）就能真正驱动这个模型去操作电脑了。

用法
----
    python qwen_tool_proxy.py              # 默认监听 8081，转发到 127.0.0.1:8080
    python qwen_tool_proxy.py --port 8081 --upstream http://127.0.0.1:8080

然后把 DSH 里该模型的 baseURL 改成  http://127.0.0.1:8081/v1  即可。
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


def _find_json(text):
    """从一个字符串里尽可能稳地挖一个 JSON 对象（返回原字符串）。"""
    if not text:
        return None
    # 去掉代码围栏
    cleaned = text
    # 只保留第一个 { 到与之配对的 } 之间的内容
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end < start:
        return None
    return cleaned[start:end + 1]


def parse_tool_call(content):
    """
    从模型原生输出中提取工具调用。
    返回 (name, arguments_json_string) ，找不到时返回 None。
    """
    if not content or not isinstance(content, str) or not content.strip():
        return None

    candidates = []

    # 1) <tools> ... </tools>（Qwen2.5-Coder 的典型格式）
    m = re.search(r"<tools>\s*([\s\S]*?)\s*</tools>", content, re.IGNORECASE)
    if m:
        candidates.append(m.group(1))

    # 2) ```json ... ``` 围栏
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
    if m:
        candidates.append(m.group(1))

    # 3) 整段直接把最外层 JSON 用《首 { 到 末 }》挖出来
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

        # 兼容 { "function": {"name": .., "arguments": ..} } 这种嵌套情况
        if name is None and isinstance(obj.get("function"), dict):
            fn = obj["function"]
            name = fn.get("name")
            args = fn.get("arguments", args)

        if not isinstance(name, str) or not name:
            continue

        # OpenAI 要求 arguments 是 JSON 字符串
        if isinstance(args, (dict, list)):
            args = json.dumps(args, ensure_ascii=False)
        elif args is None:
            args = "{}"
        elif not isinstance(args, str):
            args = json.dumps(args, ensure_ascii=False)

        return name, args

    return None


def strip_tool_blocks(content):
    """去掉工具调用块，保留余下的纯文本。"""
    if not content:
        return ""
    t = re.sub(r"<tools>[\s\S]*?</tools>", "", content)
    t = re.sub(r"```(?:json)?[\s\S]*?```", "", t)
    t = re.search(r"\{(?:[\s\S]*?)\}", t)
    return "" if t else content


class Handler(BaseHTTPRequestHandler):
    server_version = "QwenToolProxy/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # 精简日志，避免刷屏
        pass

    def _forward(self, body):
        """把请求体转发给上游 llama-server，返回 (status, dict_response)。"""
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
        # /v1/models 、健康检查等只读端点原样透传
        self._passthrough()

    def do_OPTIONS(self):
        # CORS 预检
        self.send_response(204)
        self._common_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        try:
            body = json.loads(raw) if raw else {}
        except Exception:
            body = {}

        is_chat = self.path.rstrip("/").endswith("/v1/chat/completions")
        if not is_chat:
            # 其它端点（/v1/models、健康检查等）原样透传
            self._passthrough(build=False, body=body)
            return

        client_stream = bool(body.get("stream", False))

        # 强制上游走非流式，以便完整拿到响应再改写
        upstream = dict(body)
        upstream["stream"] = False
        # 工具调用只需很短输出，给个上限防止模型“退化循环”刷满
        if body.get("tools"):
            upstream["max_tokens"] = min(int(upstream.get("max_tokens") or 1024), 2048)

        status, data = self._forward(upstream)
        if status != 200 or "choices" not in data or not data["choices"]:
            self._write_json(status, data, client_stream)
            return

        choice = data["choices"][0]
        message = choice.get("message", {})
        content = message.get("content") or ""
        parsed = parse_tool_call(content)

        if parsed:
            name, args_str = parsed
            tool_call = {
                "id": "call_" + uuid.uuid4().hex[:16],
                "type": "function",
                "function": {"name": name, "arguments": args_str},
            }
            # 重写消息
            message = {"role": "assistant", "content": "", "tool_calls": [tool_call]}
            choice["message"] = message
            choice["finish_reason"] = "tool_calls"
            # 去掉 token usage 里被模型刷的冗余，保持可用即可
            if "text" in choice:
                choice.pop("text")

        self._write_json(status, data, client_stream, toolcalls=parsed is not None)

    def _passthrough(self, build=False, body=None):
        """GET / 或 /v1/models 等非 chat 请求透传。"""
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
            # SSE 无 Content-Length，靠 Connection: close 结束，避免客户端一直等
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
        """把改写后的响应合成一条标准 SSE 流。"""
        if "choices" not in data or not data["choices"]:
            yield "data: " + json.dumps(data, ensure_ascii=False) + "\n\n"
            yield "data: [DONE]\n\n"
            return
        choice = data["choices"][0]
        mid = data.get("id", "chatcmpl-proxy")
        model = data.get("model", "")

        # 第一条：role 标记
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
    args = ap.parse_args()

    Handler.UPSTREAM = args.upstream.rstrip("/")

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[qwen_tool_proxy] listening on http://127.0.0.1:{args.port}/v1  ->  upstream {args.upstream}")
    print(f"[qwen_tool_proxy] 把 DSH 里该模型的 baseURL 改为 http://127.0.0.1:{args.port}/v1 即可让 Qwen2.5-Coder 驱动工具调用")
    srv.serve_forever()


if __name__ == "__main__":
    main()
