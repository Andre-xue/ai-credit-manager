"""
AI 积分管家 · 声音克隆 TTS 代理（阿里云函数计算 FC · 自定义运行时 / Web 函数版）

适配你在控制台看到的配置：
  运行时：自定义运行时 / Python / Python 3.10
  启动命令：python3 app.py        监听端口：9000
  代码上传方式：使用示例代码（进去后把本文件全文替换掉示例代码）

纯 Python 标准库实现，无需 Flask、无需 requirements.txt。
实现 App 端三个接口：
  POST /clone                       body {provider,name,mime,audio:dataURI} -> {voiceId}
  GET  /synthesize?voice=&text=      -> wav 音频字节
  GET  /voice?voice=                 -> wav 音频字节（试听一句）

环境变量（FC 配置 → 环境变量）：
  DASHSCOPE_API_KEY  必填，百炼 API Key（sk-ws-...）
  WORKSPACE_ID       可选，业务空间 ID；留空则走通用域名 dashscope.aliyuncs.com（推荐先用留空跑通）
  TARGET_MODEL       可选，默认 cosyvoice-v3.5-flash
函数执行超时建议改成 120 秒以上（创建音色需轮询审核状态）。
"""

import os
import json
import time
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.client import HTTPException

API_KEY = os.environ.get("DASHSCOPE_API_KEY", "").strip()
WORKSPACE_ID = os.environ.get("WORKSPACE_ID", "").strip()
TARGET_MODEL = os.environ.get("TARGET_MODEL", "cosyvoice-v3.5-flash").strip() or "cosyvoice-v3.5-flash"

if WORKSPACE_ID:
    BASE = "https://%s.cn-beijing.maas.aliyuncs.com/api/v1" % WORKSPACE_ID
else:
    BASE = "https://dashscope.aliyuncs.com/api/v1"


def _post_json(path, payload, timeout=60):
    url = BASE + path
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Authorization": "Bearer " + API_KEY, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:500]
        raise RuntimeError("百炼 HTTP %s: %s" % (e.code, detail))
    except (urllib.error.URLError, HTTPException, TimeoutError) as e:
        raise RuntimeError("百炼请求失败: %s" % e)


def _download_bytes(url, timeout=60):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def _create_voice(audio_data_uri):
    prefix = "acm" + str(int(time.time()))[-6:]
    created = _post_json("/services/audio/tts/customization", {
        "model": "voice-enrollment",
        "input": {
            "action": "create_voice",
            "target_model": TARGET_MODEL,
            "prefix": prefix,
            "audio": audio_data_uri,
            "language_hints": ["zh"],
        },
    })
    voice_id = (created.get("output") or {}).get("voice_id")
    if not voice_id:
        raise RuntimeError("创建音色未返回 voice_id: " + json.dumps(created, ensure_ascii=False)[:300])
    for _ in range(55):
        q = _post_json("/services/audio/tts/customization", {
            "model": "voice-enrollment",
            "input": {"action": "query_voice", "voice_id": voice_id},
        })
        status = (q.get("output") or {}).get("status", "")
        if status == "OK":
            return voice_id
        if status and status not in ("PENDING", "RUNNING", "DEPLOYING", "AUDITING"):
            raise RuntimeError("音色状态异常: %s" % status)
        time.sleep(1)
    raise RuntimeError("音色创建超时，请稍后在百炼控制台确认")


def _synthesize(voice_id, text):
    r = _post_json("/services/audio/tts/SpeechSynthesizer", {
        "model": TARGET_MODEL,
        "input": {"text": text[:2000], "voice": voice_id, "format": "wav", "sample_rate": 24000},
    })
    audio = (r.get("output") or {}).get("audio") or {}
    url = audio.get("url")
    if not url:
        raise RuntimeError("合成未返回音频地址: " + json.dumps(r, ensure_ascii=False)[:300])
    return _download_bytes(url)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _audio(self, data):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, message, status=500):
        self._json({"error": str(message)[:500]}, status)

    def _ready(self):
        if not API_KEY:
            self._error("服务端未配置 DASHSCOPE_API_KEY", 500)
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/")
        if path != "/clone" or not self._ready():
            if path != "/clone":
                self._error("未知路径: " + path, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            self._error("请求体不是合法 JSON", 400)
            return
        audio = body.get("audio", "")
        if not isinstance(audio, str) or not audio.startswith("data:"):
            self._error("audio 需为 data URI（data:audio/...;base64,...）", 400)
            return
        try:
            self._json({"voiceId": _create_voice(audio)})
        except Exception as e:
            self._error(e)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)
        if path not in ("/synthesize", "/voice") or not self._ready():
            if path not in ("/synthesize", "/voice"):
                self._error("未知路径: " + path, 404)
            return
        voice = (query.get("voice") or [""])[0]
        text = (query.get("text") or [""])[0]
        if not voice:
            self._error("缺少 voice 参数", 400)
            return
        if path == "/voice" and not text:
            text = "你好，这是声音克隆的试听。"
        if not text:
            self._error("缺少 text 参数", 400)
            return
        try:
            self._audio(_synthesize(voice, text))
        except Exception as e:
            self._error(e)

    def log_message(self, fmt, *args):
        pass  # 减少日志噪声


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 9000), Handler).serve_forever()
