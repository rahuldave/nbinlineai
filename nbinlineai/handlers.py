"""Authenticated Jupyter Server HTTP endpoints for prompt cells."""

import asyncio
import json
import os

from fastllm.acomplete import ContextWindowExceededError as ProviderContextWindowExceededError
from fasttransport.errors import APIError
from jupyter_server.auth.decorator import authorized
from jupyter_server.auth.identity import IdentityProvider, PasswordIdentityProvider
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado.iostream import StreamClosedError
from tornado.web import HTTPError, authenticated

from .config import DEFAULT_MODELS, MODEL_CAPABILITIES, key_settings_status, provider_status
from .credentials import CredentialStore
from .frontend_bridge import BridgeConflict, BridgeNotFound, FrontendBridge
from .kernel import KernelDispatcher
from .prompt import PROMPT_MODE_INSTRUCTIONS, preview_context, run_prompt, validate_request


def _require_single_user_server(handler):
    """Shared custom identity servers cannot safely share one OS-user key file."""
    provider = handler.settings.get("identity_provider")
    if provider is not None and type(provider) not in (IdentityProvider, PasswordIdentityProvider) and not os.getenv(
        "JUPYTERHUB_USER"
    ):
        raise HTTPError(403, "API keys require a single-user Jupyter server")


def _safe_provider_error(exc: APIError) -> str:
    if isinstance(exc, ProviderContextWindowExceededError):
        return "Model context window exceeded. Shorten the prompt or notebook context, or register fewer tools."
    if exc.status_code in (401, 403):
        return "API key rejected; check Configure AI"
    if exc.status_code == 429:
        return "Provider rate limit or quota reached"
    if exc.status_code == 404:
        return "Selected model is unavailable; choose another model"
    return "Model request failed"


def _running_version() -> str:
    # Imported at request time because __init__ defines __version__ after it
    # imports this module. This reflects the server process, not a newer wheel.
    from . import __version__

    return __version__


class StatusHandler(APIHandler):
    @authenticated
    @authorized(action="execute", resource="kernels")
    def get(self):
        _require_single_user_server(self)
        self.finish({
            "extension": "nbinlineai",
            "status": "ready",
            "version": _running_version(),
            "providers": provider_status(),
            "default_models": DEFAULT_MODELS,
            "prompt_mode_instructions": PROMPT_MODE_INSTRUCTIONS,
            "model_capabilities": MODEL_CAPABILITIES,
        })


class PromptHandler(APIHandler):
    def initialize(self, dispatcher, bridge=None):
        self.dispatcher = dispatcher
        self.bridge = bridge if bridge is not None else FrontendBridge()
        self._run_task = None

    @authenticated
    @authorized(action="execute", resource="kernels")
    async def post(self):
        _require_single_user_server(self)
        try:
            body = validate_request(self.get_json_body())
            kernel_id, kernel = await self.dispatcher.resolve(body["session_id"])
            run = self.bridge.start(body["session_id"], body["prompt_cell_id"], kernel_id, kernel)
        except (ValueError, TypeError) as exc:
            raise HTTPError(400, str(exc)) from exc
        self.set_header("Content-Type", "text/event-stream; charset=utf-8")
        self.set_header("Cache-Control", "no-cache, no-transform")
        self.set_header("X-Accel-Buffering", "no")
        self._run_task = asyncio.current_task()
        try:
            async for event in run_prompt(body, self.dispatcher, kernel_id, kernel, self.bridge, run):
                if event.get("type") == "context":
                    event = {**event, "run_id": run.run_id}
                self.write("data: " + json.dumps(event, ensure_ascii=False) + "\n\n")
                await self.flush()
        except (asyncio.CancelledError, StreamClosedError):
            # A disconnected client cancelled this request. Kernel/provider cleanup
            # already ran as cancellation propagated through the prompt iterator.
            return
        except APIError as exc:
            self.write("data: " + json.dumps({"type": "error", "message": _safe_provider_error(exc)}) + "\n\n")
            await self.flush()
        except Exception as exc:  # noqa: BLE001 - provider and kernel failures must end the SSE run
            message = str(exc) if isinstance(exc, (ValueError, TimeoutError)) else "Model or kernel request failed"
            self.write("data: " + json.dumps({"type": "error", "message": message}) + "\n\n")
            await self.flush()
        finally:
            self.bridge.close(run)
            self._run_task = None

    def on_connection_close(self):
        if self._run_task and not self._run_task.done():
            self._run_task.cancel()
        super().on_connection_close()


class ContextPreviewHandler(APIHandler):
    def initialize(self, dispatcher):
        self.dispatcher = dispatcher

    @authenticated
    @authorized(action="execute", resource="kernels")
    async def post(self):
        _require_single_user_server(self)
        try:
            body = validate_request(self.get_json_body(), preview=True)
            kernel_id, kernel = await self.dispatcher.resolve(body["session_id"])
            if not self.dispatcher.preview_ready(kernel_id, kernel):
                raise HTTPError(409, "Kernel is busy; refresh the context preview when it is idle")
            report = await asyncio.wait_for(
                preview_context(body, self.dispatcher, kernel_id, kernel), timeout=7
            )
            current_id, current_kernel = await self.dispatcher.resolve(body["session_id"])
            if current_id != kernel_id or current_kernel is not kernel:
                raise HTTPError(409, "Notebook kernel changed; refresh the context preview")
            if not self.dispatcher.preview_ready(kernel_id, kernel):
                raise HTTPError(409, "Kernel changed or became busy; refresh the context preview")
        except (ValueError, TypeError) as exc:
            status = 409 if "Kernel is busy" in str(exc) else 400
            raise HTTPError(status, str(exc)) from exc
        except TimeoutError as exc:
            raise HTTPError(409, "Context preview timed out; refresh when the kernel is idle") from exc
        self.finish(report)


class ActionReplyHandler(APIHandler):
    def initialize(self, dispatcher, bridge):
        self.dispatcher = dispatcher
        self.bridge = bridge

    @authenticated
    @authorized(action="execute", resource="kernels")
    async def post(self):
        _require_single_user_server(self)
        try:
            await self.bridge.reply(self.get_json_body(), self.dispatcher)
        except BridgeNotFound as exc:
            raise HTTPError(404, str(exc)) from exc
        except BridgeConflict as exc:
            raise HTTPError(409, str(exc)) from exc
        except (ValueError, TypeError) as exc:
            raise HTTPError(400, str(exc)) from exc
        self.finish({"accepted": True})


class KeySettingsHandler(APIHandler):
    @authenticated
    @authorized(action="execute", resource="kernels")
    def get(self):
        _require_single_user_server(self)
        self.finish(key_settings_status())

    @authenticated
    @authorized(action="execute", resource="kernels")
    async def post(self):
        _require_single_user_server(self)
        body = self.get_json_body()
        if not isinstance(body, dict):
            raise HTTPError(400, "Request body must be a JSON object")
        try:
            await asyncio.to_thread(CredentialStore().save, body.get("backend"), body.get("key"))
        except ValueError as exc:
            raise HTTPError(400, str(exc)) from exc
        self.finish(key_settings_status())


class KeySettingsItemHandler(APIHandler):
    @authenticated
    @authorized(action="execute", resource="kernels")
    async def delete(self, backend):
        _require_single_user_server(self)
        try:
            await asyncio.to_thread(CredentialStore().delete, backend)
        except ValueError as exc:
            raise HTTPError(400, str(exc)) from exc
        self.finish(key_settings_status())


def setup_handlers(web_app):
    base_url = web_app.settings["base_url"]
    dispatcher = KernelDispatcher(web_app.settings["session_manager"], web_app.settings["kernel_manager"])
    bridge = FrontendBridge()
    web_app.add_handlers(r".*$", [
        (url_path_join(base_url, "nbinlineai", "status"), StatusHandler),
        (url_path_join(base_url, "nbinlineai", "prompt"), PromptHandler,
         {"dispatcher": dispatcher, "bridge": bridge}),
        (url_path_join(base_url, "nbinlineai", "context-preview"), ContextPreviewHandler,
         {"dispatcher": dispatcher}),
        (url_path_join(base_url, "nbinlineai", "action-reply"), ActionReplyHandler,
         {"dispatcher": dispatcher, "bridge": bridge}),
        (url_path_join(base_url, "nbinlineai", "settings", "keys"), KeySettingsHandler),
        (url_path_join(base_url, "nbinlineai", "settings", "keys", r"([^/]+)"), KeySettingsItemHandler),
    ])
