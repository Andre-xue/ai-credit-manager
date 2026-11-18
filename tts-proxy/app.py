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
  阿里云百炼（provider=aliyun）：
    DASHSCOPE_API_KEY  必填，百炼 API Key（sk-ws-...）
    WORKSPACE_ID       可选，业务空间 ID；留空则走通用域名 dashscope.aliyuncs.com（推荐先用留空跑通）
    TARGET_MODEL       可选，默认 cosyvoice-v3.5-flash
  火山引擎（provider=volcengine）：
    VOLC_APP_ID        必填，火山 APP ID
    VOLC_ACCESS_TOKEN  必填，火山 Access Token
    VOLC_CLONE_ENDPOINT  可选，音色训练端点，默认 https://openspeech.bytedance.com/api/v1/vc/submit
    VOLC_TTS_ENDPOINT    可选，语音合成端点，默认 https://openspeech.bytedance.com/api/v1/tts
    VOLC_TTS_CLUSTER     可选，合成 cluster，默认 volcano_icl
  函数执行超时建议改成 120 秒以上（创建音色需轮询审核状态）。
"""

import os
import json
import time
import uuid
import base64
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.client import HTTPException

API_KEY = os.environ.get("DASHSCOPE_API_KEY", "").strip()
WORKSPACE_ID = os.environ.get("WORKSPACE_ID", "").strip()
TARGET_MODEL = os.environ.get("TARGET_MODEL", "cosyvoice-v3.5-flash").strip() or "cosyvoice-v3.5-flash"

VOLC_APP_ID = os.environ.get("VOLC_APP_ID", "").strip()
VOLC_ACCESS_TOKEN = os.environ.get("VOLC_ACCESS_TOKEN", "").strip()
VOLC_CLONE_ENDPOINT = os.environ.get("VOLC_CLONE_ENDPOINT", "https://openspeech.bytedance.com/api/v1/vc/submit").strip()
VOLC_TTS_ENDPOINT = os.environ.get("VOLC_TTS_ENDPOINT", "https://openspeech.bytedance.com/api/v1/tts").strip()
VOLC_TTS_CLUSTER = os.environ.get("VOLC_TTS_CLUSTER", "volcano_icl").strip() or "volcano_icl"

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


# ---------------- 火山引擎（provider=volcengine）----------------
def _volc_headers():
    return {
        "Content-Type": "application/json",
        "X-Api-App-Key": VOLC_APP_ID,
        "X-Api-Access-Key": VOLC_ACCESS_TOKEN,
        "X-Api-Request-Id": str(uuid.uuid4()),
    }


def _volc_post_json(url, payload, timeout=90):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=_volc_headers(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:500]
        raise RuntimeError("火山 HTTP %s: %s" % (e.code, detail))
    except (urllib.error.URLError, HTTPException, TimeoutError) as e:
        raise RuntimeError("火山请求失败: %s" % e)


def _data_uri_to_b64(audio_data_uri):
    if "," in audio_data_uri:
        return audio_data_uri.split(",", 1)[1]
    return audio_data_uri


def _volc_create_voice(audio_data_uri, name):
    # 声音复刻 2.0：提交训练任务。不同服务形态的请求体略有差异，这里用豆包语音 vc/submit 通用结构，
    # 音频以 base64 传入；返回的 speaker_id / custom_speaker_id 作为 voiceId。
    b64 = _data_uri_to_b64(audio_data_uri)
    custom_id = "acm_" + str(int(time.time()))[-8:]
    payload = {
        "app": {"appid": VOLC_APP_ID, "token": VOLC_ACCESS_TOKEN},
        "speaker_id": "custom_speaker_id",
        "custom_speaker_id": custom_id,
        "audio_data": b64,
        "audio_format": "wav",
        "language": "cn",
    }
    raw = _volc_post_json(VOLC_CLONE_ENDPOINT, payload, timeout=90)
    try:
        obj = json.loads(raw.decode("utf-8"))
    except Exception:
        raise RuntimeError("火山音色训练返回非 JSON: " + raw[:200].decode("utf-8", "ignore"))
    voice_id = (obj.get("data") or {}).get("speaker_id") or obj.get("speaker_id") or custom_id
    return voice_id


def _volc_synthesize(voice_id, text):
    payload = {
        "app": {"appid": VOLC_APP_ID, "token": VOLC_ACCESS_TOKEN, "cluster": VOLC_TTS_CLUSTER},
        "audio": {"voice_type": voice_id, "encoding": "wav", "rate": 24000},
        "request": {"reqid": str(uuid.uuid4()), "operation": "query"},
        "text": text[:1024],
    }
    raw = _volc_post_json(VOLC_TTS_ENDPOINT, payload, timeout=60)
    # 成功时直接是音频字节；失败时是 JSON 错误
    if raw[:1] in (b"{", b"["):
        raise RuntimeError("火山合成失败: " + raw[:300].decode("utf-8", "ignore"))
    return raw


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

    def _ready(self, provider=""):
        if provider == "volcengine":
            if not (VOLC_APP_ID and VOLC_ACCESS_TOKEN):
                self._error("服务端未配置 VOLC_APP_ID / VOLC_ACCESS_TOKEN", 500)
                return False
            return True
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
        provider = (body.get("provider") or "").strip()
        if not self._ready(provider):
            return
        audio = body.get("audio", "")
        if not isinstance(audio, str) or not audio.startswith("data:"):
            self._error("audio 需为 data URI（data:audio/...;base64,...）", 400)
            return
        try:
            if provider == "volcengine":
                voice_id = _volc_create_voice(audio, body.get("name") or "cloned")
            else:
                voice_id = _create_voice(audio)
            self._json({"voiceId": voice_id})
        except Exception as e:
            self._error(e)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)
        if path not in ("/synthesize", "/voice"):
            self._error("未知路径: " + path, 404)
            return
        voice = (query.get("voice") or [""])[0]
        text = (query.get("text") or [""])[0]
        provider = (query.get("provider") or [""])[0].strip()
        if not voice:
            self._error("缺少 voice 参数", 400)
            return
        if path == "/voice" and not text:
            text = "你好，这是声音克隆的试听。"
        if not text:
            self._error("缺少 text 参数", 400)
            return
        if not self._ready(provider):
            return
        try:
            if provider == "volcengine":
                audio_bytes = _volc_synthesize(voice, text)
            else:
                audio_bytes = _synthesize(voice, text)
            self._audio(audio_bytes)
        except Exception as e:
            self._error(e)

    def log_message(self, fmt, *args):
        pass  # 减少日志噪声


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 9000), Handler).serve_forever()
