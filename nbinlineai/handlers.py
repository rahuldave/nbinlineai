"""Authenticated Jupyter Server HTTP endpoints for prompt cells."""

import asyncio
import json

from jupyter_server.auth.decorator import authorized
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado.iostream import StreamClosedError
from tornado.web import HTTPError, authenticated

from .config import DEFAULT_MODELS, provider_status
from .kernel import KernelDispatcher
from .prompt import run_prompt, validate_request


class StatusHandler(APIHandler):
    @authenticated
    def get(self):
        self.finish({
            "extension": "nbinlineai",
            "status": "ready",
            "providers": provider_status(),
            "default_models": DEFAULT_MODELS,
        })


class PromptHandler(APIHandler):
    def initialize(self, dispatcher):
        self.dispatcher = dispatcher
        self._run_task = None

    @authenticated
    @authorized(action="execute", resource="kernels")
    async def post(self):
        try:
            body = validate_request(self.get_json_body())
            kernel_id, kernel = await self.dispatcher.resolve(body["session_id"])
        except (ValueError, TypeError) as exc:
            raise HTTPError(400, str(exc)) from exc
        self.set_header("Content-Type", "text/event-stream; charset=utf-8")
        self.set_header("Cache-Control", "no-cache, no-transform")
        self.set_header("X-Accel-Buffering", "no")
        self._run_task = asyncio.current_task()
        try:
            async for event in run_prompt(body, self.dispatcher, kernel_id, kernel):
                self.write("data: " + json.dumps(event, ensure_ascii=False) + "\n\n")
                await self.flush()
        except (asyncio.CancelledError, StreamClosedError):
            # A disconnected client cancelled this request. Kernel/provider cleanup
            # already ran as cancellation propagated through the prompt iterator.
            return
        except Exception as exc:  # noqa: BLE001 - provider and kernel failures must end the SSE run
            message = str(exc) if isinstance(exc, (ValueError, TimeoutError)) else "Model or kernel request failed"
            self.write("data: " + json.dumps({"type": "error", "message": message}) + "\n\n")
            await self.flush()
        finally:
            self._run_task = None

    def on_connection_close(self):
        if self._run_task and not self._run_task.done():
            self._run_task.cancel()
        super().on_connection_close()


def setup_handlers(web_app):
    base_url = web_app.settings["base_url"]
    dispatcher = KernelDispatcher(web_app.settings["session_manager"], web_app.settings["kernel_manager"])
    web_app.add_handlers(r".*$", [
        (url_path_join(base_url, "nbinlineai", "status"), StatusHandler),
        (url_path_join(base_url, "nbinlineai", "prompt"), PromptHandler, {"dispatcher": dispatcher}),
    ])
