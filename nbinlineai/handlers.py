"""Authenticated Jupyter Server HTTP endpoints for prompt cells."""

import asyncio
import json
import logging
import os
import re

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
from .notebook_scope import NotebookScopeResolver
from .prompt import PROMPT_MODE_INSTRUCTIONS, preview_context, run_prompt, validate_request
from .subscription_runtime import SubscriptionRuntimeError
from .subscription_settings import SubscriptionSettings

LOGGER = logging.getLogger(__name__)


def _require_single_user_server(handler):
    """Shared custom identity servers cannot safely share one OS-user key file."""
    provider = handler.settings.get("identity_provider")
    if provider is not None and type(provider) not in (IdentityProvider, PasswordIdentityProvider) and not os.getenv(
        "JUPYTERHUB_USER"
    ):
        raise HTTPError(403, "AI account and API keys require a single-user Jupyter server")


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


def _safe_subscription_status(status: dict) -> dict:
    """Expose only presentation fields from an account/runtime status object."""
    if not isinstance(status, dict):
        raise TypeError("ChatGPT connection status is unavailable")
    states = {
        "missing_runtime", "incompatible_runtime", "installing", "signed_out",
        "connecting", "connected", "expired", "limited", "offline", "error",
    }
    usage_states = {"available", "unavailable", "limited"}
    efforts = {"none", "low", "medium", "high", "xhigh", "max", "ultra"}

    def safe_text(value, maximum):
        return value if (isinstance(value, str) and 0 < len(value) <= maximum
                         and all(ord(char) >= 32 for char in value)) else None

    state = status.get("state")
    result = {
        "state": state if isinstance(state, str) and state in states else "error",
        "configured": status.get("configured") is True,
    }
    if status.get("auth_mode") == "chatgpt":
        result["auth_mode"] = "chatgpt"
    if message := safe_text(status.get("message"), 500):
        result["message"] = message
    account = status.get("account")
    if isinstance(account, dict):
        result["account"] = {
            key: value for key, maximum in (
                ("display_name", 120), ("email", 254), ("workspace", 120)
            ) if (value := safe_text(account.get(key), maximum))
        }
    models = status.get("models")
    result["models"] = []
    if isinstance(models, list):
        for model in models[:100]:
            if not isinstance(model, dict):
                continue
            model_id = model.get("id")
            if not isinstance(model_id, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,100}", model_id):
                continue
            item = {"id": model_id, "efforts": [
                effort for effort in model.get("efforts", [])[:7]
                if isinstance(effort, str) and effort in efforts
            ] if isinstance(model.get("efforts"), list) else []}
            if display := safe_text(model.get("display_name"), 120):
                item["display_name"] = display
            if isinstance(model.get("default_effort"), str) and model["default_effort"] in efforts:
                item["default_effort"] = model["default_effort"]
            result["models"].append(item)
    usage = status.get("usage")
    result["usage"] = {"state": "unavailable"}
    if isinstance(usage, dict):
        usage_state = usage.get("state")
        result["usage"]["state"] = (usage_state if isinstance(usage_state, str)
                                    and usage_state in usage_states else "unavailable")
        remaining = usage.get("remaining_percent")
        if isinstance(remaining, (float, int)) and not isinstance(remaining, bool) and 0 <= remaining <= 100:
            result["usage"]["remaining_percent"] = remaining
        if reset_at := safe_text(usage.get("reset_at"), 100):
            result["usage"]["reset_at"] = reset_at
        if message := safe_text(usage.get("message"), 500):
            result["usage"]["message"] = message
    return result


async def _notebook_subscription_scope(dispatcher, scope_resolver, session_id: str) -> dict:
    if scope_resolver is None:
        raise ValueError("ChatGPT file access requires a local JupyterLab project folder")
    session = await dispatcher.sessions.get_session(session_id=session_id)
    access = await asyncio.to_thread(SubscriptionSettings().get_file_access)
    scope = scope_resolver.resolve(session, access=access)
    return {
        "session_id": scope.session_id,
        "notebook_path": scope.notebook_path,
        "working_folder": str(scope.working_folder),
        "project_root": str(scope.project_root),
        "file_access_root": str(scope.file_access_root),
        "access": scope.access,
    }


def _running_version() -> str:
    # Imported at request time because __init__ defines __version__ after it
    # imports this module. This reflects the server process, not a newer wheel.
    from . import __version__

    return __version__


class StatusHandler(APIHandler):
    def initialize(self, subscription_manager=None):
        self.subscription_manager = subscription_manager

    @authenticated
    @authorized(action="execute", resource="kernels")
    async def get(self):
        _require_single_user_server(self)
        providers = provider_status()
        capabilities = {**MODEL_CAPABILITIES}
        if self.subscription_manager is not None:
            try:
                subscription = _safe_subscription_status(await self.subscription_manager.status())
            except Exception:  # noqa: BLE001 - status must not expose runtime/account internals
                subscription = {"state": "offline", "configured": False, "models": [],
                                "usage": {"state": "unavailable"}}
            models = subscription["models"]
            connected = (subscription["state"] in ("connected", "limited")
                         and subscription["configured"] and subscription.get("auth_mode") == "chatgpt")
            providers["openai_codex_subscription"] = {
                "configured": connected and bool(models),
                "source": None,
                "state": subscription["state"],
                "default_model": models[0]["id"] if models else None,
                "models": [model["id"] for model in models],
            }
            capabilities["openai_codex_subscription"] = {
                model["id"]: {
                    "efforts": model["efforts"],
                    "default_effort": model.get("default_effort"),
                } for model in models
            }
        self.finish({
            "extension": "nbinlineai",
            "status": "ready",
            "version": _running_version(),
            "providers": providers,
            "default_models": DEFAULT_MODELS,
            "prompt_mode_instructions": PROMPT_MODE_INSTRUCTIONS,
            "model_capabilities": capabilities,
            "subscription_capable": self.subscription_manager is not None,
        })


class PromptHandler(APIHandler):
    def initialize(self, dispatcher, bridge=None, subscription_manager=None, scope_resolver=None):
        self.dispatcher = dispatcher
        self.bridge = bridge if bridge is not None else FrontendBridge()
        self.subscription_manager = subscription_manager
        self.scope_resolver = scope_resolver
        self._run_task = None

    @authenticated
    @authorized(action="execute", resource="kernels")
    async def post(self):
        _require_single_user_server(self)
        try:
            body = validate_request(self.get_json_body())
            kernel_id, kernel = await self.dispatcher.resolve(body["session_id"])
            subscription_scope = None
            if body["backend"] == "openai_codex_subscription":
                if self.subscription_manager is None or self.scope_resolver is None:
                    raise ValueError("ChatGPT subscription connection is unavailable")
                subscription = _safe_subscription_status(await self.subscription_manager.status())
                models = {model["id"]: model for model in subscription["models"]}
                if (subscription["state"] not in ("connected", "limited") or not subscription["configured"]
                        or subscription.get("auth_mode") != "chatgpt"):
                    raise ValueError("ChatGPT account is not connected")
                if body["model"] not in models:
                    raise ValueError("Selected ChatGPT model is unavailable")
                if (body["reasoning_effort"] is not None
                        and body["reasoning_effort"] not in models[body["model"]]["efforts"]):
                    raise ValueError("Selected ChatGPT reasoning effort is unavailable")
                subscription_scope = await _notebook_subscription_scope(
                    self.dispatcher, self.scope_resolver, body["session_id"],
                )
            run = self.bridge.start(body["session_id"], body["prompt_cell_id"], kernel_id, kernel)
        except (ValueError, TypeError) as exc:
            raise HTTPError(400, str(exc)) from exc
        self.set_header("Content-Type", "text/event-stream; charset=utf-8")
        self.set_header("Cache-Control", "no-cache, no-transform")
        self.set_header("X-Accel-Buffering", "no")
        self._run_task = asyncio.current_task()
        try:
            kwargs = ({"subscription_runtime": self.subscription_manager, "subscription_scope": subscription_scope}
                      if subscription_scope else {})
            async for event in run_prompt(body, self.dispatcher, kernel_id, kernel, self.bridge, run, **kwargs):
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
        except SubscriptionRuntimeError as exc:
            self.write("data: " + json.dumps({"type": "error", "message": str(exc)}) + "\n\n")
            await self.flush()
        except Exception as exc:  # noqa: BLE001 - provider and kernel failures must end the SSE run
            message = str(exc) if isinstance(exc, (ValueError, TimeoutError)) else "Model or kernel request failed"
            self.write("data: " + json.dumps({"type": "error", "message": message}) + "\n\n")
            await self.flush()
        finally:
            self.bridge.close(run)
            if subscription_scope is not None:
                try:
                    await self.subscription_manager.cancel(run.run_id)
                except Exception as exc:  # noqa: BLE001 - owned child cleanup must not mask the SSE result
                    LOGGER.warning("ChatGPT run cleanup failed: %s", type(exc).__name__)
            self._run_task = None

    def on_connection_close(self):
        if self._run_task and not self._run_task.done():
            self._run_task.cancel()
        super().on_connection_close()


class ContextPreviewHandler(APIHandler):
    def initialize(self, dispatcher, subscription_manager=None, scope_resolver=None):
        self.dispatcher = dispatcher
        self.subscription_manager = subscription_manager
        self.scope_resolver = scope_resolver

    @authenticated
    @authorized(action="execute", resource="kernels")
    async def post(self):
        _require_single_user_server(self)
        try:
            body = validate_request(self.get_json_body(), preview=True)
            kernel_id, kernel = await self.dispatcher.resolve(body["session_id"])
            subscription_scope = None
            if body["backend"] == "openai_codex_subscription" and self.scope_resolver is not None:
                subscription_scope = await _notebook_subscription_scope(
                    self.dispatcher, self.scope_resolver, body["session_id"],
                )
            if not self.dispatcher.preview_ready(kernel_id, kernel):
                raise HTTPError(409, "Kernel is busy; refresh the context preview when it is idle")
            report = await asyncio.wait_for(
                preview_context(body, self.dispatcher, kernel_id, kernel,
                                subscription_runtime=self.subscription_manager,
                                subscription_scope=subscription_scope), timeout=7
            )
            # The preview's own silent inspection has received its IOPub idle
            # message, but the kernel manager may process that status on the
            # next event-loop turn. Yield once, then enforce the same final
            # identity and idle checks for any intervening notebook execution.
            await asyncio.sleep(0)
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


class SubscriptionHandlerBase(APIHandler):
    """Account routes share Jupyter authorization and a server-frozen file root."""

    def initialize(self, dispatcher, scope_resolver=None, subscription_manager=None):
        self.dispatcher = dispatcher
        self.scope_resolver = scope_resolver
        self.subscription_manager = subscription_manager

    def _manager(self):
        if self.subscription_manager is None:
            raise HTTPError(503, "ChatGPT subscription is unavailable in this version")
        return self.subscription_manager

    async def _scope_details(self, session_id: str | None) -> dict:
        access = await asyncio.to_thread(SubscriptionSettings().get_file_access)
        # The saved choice is preparatory. The isolated Codex runtime has no
        # native file tools, and kernel tools retain their own permissions.
        result = {"file_access": access, "native_files_capable": False}
        if session_id:
            if self.scope_resolver is None:
                raise HTTPError(409, "ChatGPT file access requires a local JupyterLab project folder")
            session = await self.dispatcher.sessions.get_session(session_id=session_id)
            try:
                scope = self.scope_resolver.resolve(session, access=access)
            except ValueError as exc:
                raise HTTPError(409, str(exc)) from exc
            result.update({
                "project_root": str(scope.project_root),
                "working_folder": str(scope.working_folder),
            })
        return result


class SubscriptionStatusHandler(SubscriptionHandlerBase):
    @authenticated
    @authorized(action="execute", resource="kernels")
    async def get(self):
        _require_single_user_server(self)
        details = await self._scope_details(self.get_query_argument("session_id", None))
        if self.subscription_manager is None:
            self.finish({
                "state": "missing_runtime", "configured": False, "models": [],
                "usage": {"state": "unavailable"},
                "message": "ChatGPT subscription is unavailable in this version",
                **details,
            })
            return
        try:
            status = _safe_subscription_status(await self.subscription_manager.status())
        except SubscriptionRuntimeError as exc:
            self.finish({
                "state": "error", "configured": False, "models": [],
                "usage": {"state": "unavailable"}, "message": str(exc), **details,
            })
            return
        except (TypeError, ValueError) as exc:
            raise HTTPError(503, "ChatGPT connection status is unavailable") from exc
        self.finish({**status, **details})


class SubscriptionLoginHandler(SubscriptionHandlerBase):
    @authenticated
    @authorized(action="execute", resource="kernels")
    async def post(self):
        _require_single_user_server(self)
        body = self.get_json_body()
        if not isinstance(body, dict) or set(body) != {"method"} or body["method"] not in ("browser", "device"):
            raise HTTPError(400, "Choose browser or device sign-in")
        try:
            result = await self._manager().start_login(body["method"])
        except SubscriptionRuntimeError as exc:
            raise HTTPError(503, str(exc)) from exc
        self.finish(result)


class SubscriptionLoginCancelHandler(SubscriptionHandlerBase):
    @authenticated
    @authorized(action="execute", resource="kernels")
    async def post(self):
        _require_single_user_server(self)
        body = self.get_json_body()
        if (not isinstance(body, dict) or set(body) != {"login_id"}
                or not isinstance(body["login_id"], str) or not body["login_id"]):
            raise HTTPError(400, "login_id is required")
        try:
            await self._manager().cancel_login(body["login_id"])
        except ValueError as exc:
            raise HTTPError(409, str(exc)) from exc
        except SubscriptionRuntimeError as exc:
            raise HTTPError(503, str(exc)) from exc
        self.finish({"cancelled": True})


class SubscriptionDisconnectHandler(SubscriptionHandlerBase):
    @authenticated
    @authorized(action="execute", resource="kernels")
    async def post(self):
        _require_single_user_server(self)
        body = self.get_json_body()
        if body not in (None, {}):
            raise HTTPError(400, "Disconnect takes no options")
        try:
            await self._manager().disconnect()
        except SubscriptionRuntimeError as exc:
            raise HTTPError(503, str(exc)) from exc
        self.finish({"disconnected": True})


class SubscriptionUsageHandler(SubscriptionHandlerBase):
    @authenticated
    @authorized(action="execute", resource="kernels")
    async def get(self):
        _require_single_user_server(self)
        try:
            usage = await self._manager().usage()
        except SubscriptionRuntimeError:
            usage = {"state": "unavailable"}
        self.finish(_safe_subscription_status({"usage": usage})["usage"])


class SubscriptionFileAccessHandler(SubscriptionHandlerBase):
    @authenticated
    @authorized(action="execute", resource="kernels")
    async def get(self):
        _require_single_user_server(self)
        self.finish(await self._scope_details(self.get_query_argument("session_id", None)))

    @authenticated
    @authorized(action="execute", resource="kernels")
    async def post(self):
        _require_single_user_server(self)
        body = self.get_json_body()
        if (not isinstance(body, dict) or set(body) != {"scope", "session_id"}
                or body["scope"] not in ("project", "notebook")
                or not isinstance(body["session_id"], str) or not body["session_id"]):
            raise HTTPError(400, "A notebook session and ChatGPT file access choice are required")
        if self.scope_resolver is None:
            raise HTTPError(409, "ChatGPT file access requires a local JupyterLab project folder")
        session = await self.dispatcher.sessions.get_session(session_id=body["session_id"])
        try:
            self.scope_resolver.resolve(session, access=body["scope"])
        except ValueError as exc:
            raise HTTPError(409, str(exc)) from exc
        await asyncio.to_thread(SubscriptionSettings().set_file_access, body["scope"])
        self.finish(await self._scope_details(body["session_id"]))


def setup_handlers(web_app, *, subscription_manager=None):
    base_url = web_app.settings["base_url"]
    dispatcher = KernelDispatcher(web_app.settings["session_manager"], web_app.settings["kernel_manager"])
    bridge = FrontendBridge()
    contents_manager = web_app.settings.get("contents_manager")
    try:
        scope_resolver = NotebookScopeResolver(contents_manager) if contents_manager is not None else None
    except (OSError, ValueError):
        scope_resolver = None
    subscription_args = {
        "dispatcher": dispatcher,
        "scope_resolver": scope_resolver,
        "subscription_manager": subscription_manager,
    }
    web_app.add_handlers(r".*$", [
        (url_path_join(base_url, "nbinlineai", "status"), StatusHandler,
         {"subscription_manager": subscription_manager}),
        (url_path_join(base_url, "nbinlineai", "prompt"), PromptHandler,
         {"dispatcher": dispatcher, "bridge": bridge, "subscription_manager": subscription_manager,
          "scope_resolver": scope_resolver}),
        (url_path_join(base_url, "nbinlineai", "context-preview"), ContextPreviewHandler,
         {"dispatcher": dispatcher, "subscription_manager": subscription_manager,
          "scope_resolver": scope_resolver}),
        (url_path_join(base_url, "nbinlineai", "action-reply"), ActionReplyHandler,
         {"dispatcher": dispatcher, "bridge": bridge}),
        (url_path_join(base_url, "nbinlineai", "settings", "keys"), KeySettingsHandler),
        (url_path_join(base_url, "nbinlineai", "settings", "keys", r"([^/]+)"), KeySettingsItemHandler),
        (url_path_join(base_url, "nbinlineai", "subscription", "status"),
         SubscriptionStatusHandler, subscription_args),
        (url_path_join(base_url, "nbinlineai", "subscription", "login"),
         SubscriptionLoginHandler, subscription_args),
        (url_path_join(base_url, "nbinlineai", "subscription", "login", "cancel"),
         SubscriptionLoginCancelHandler, subscription_args),
        (url_path_join(base_url, "nbinlineai", "subscription", "disconnect"),
         SubscriptionDisconnectHandler, subscription_args),
        (url_path_join(base_url, "nbinlineai", "subscription", "usage"),
         SubscriptionUsageHandler, subscription_args),
        (url_path_join(base_url, "nbinlineai", "subscription", "file-access"),
         SubscriptionFileAccessHandler, subscription_args),
    ])
