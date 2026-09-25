"""Session-bound Python kernel introspection and tool execution."""

import asyncio
import base64
import json
import re
import textwrap
import uuid
from queue import Empty

from tornado.web import HTTPError

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MARKER = "__NBINLINEAI_RESULT__:"
MAX_RESULT_CHARS = 4000
PREVIEW_STATUS_TIMEOUT = 0.5


def _payload_code(operation: str, payload: dict) -> str:
    encoded = base64.b64encode(json.dumps(payload).encode()).decode()
    # The user-controlled bytes enter Python only as decoded JSON, never source code.
    source = f"""
import base64 as _nb_b64, json as _nb_json, inspect as _nb_inspect, io as _nb_io, contextlib as _nb_ctx
_nb_payload = _nb_json.loads(_nb_b64.b64decode({encoded!r}))
_nb_ns = get_ipython().user_ns
_nb_out = {{}}
try:
    if {operation!r} == 'inspect':
        for _nb_name in _nb_payload['names']:
            if _nb_name not in _nb_ns:
                _nb_out[_nb_name] = {{'error': 'Name is not defined'}}
                continue
            _nb_obj = _nb_ns[_nb_name]
            if _nb_name in _nb_payload['functions']:
                if not callable(_nb_obj):
                    _nb_out[_nb_name] = {{'error': 'Name is not callable'}}
                    continue
                _nb_sig = _nb_inspect.signature(_nb_obj)
                _nb_params = {{}}
                for _nb_p in _nb_sig.parameters.values():
                    if _nb_p.kind not in (_nb_p.POSITIONAL_OR_KEYWORD, _nb_p.KEYWORD_ONLY):
                        raise TypeError('Unsupported function signature')
                    _nb_ann = _nb_p.annotation
                    _nb_type = 'str' if _nb_ann is _nb_p.empty else (str(_nb_ann) if getattr(_nb_ann, '__args__', None) else getattr(_nb_ann, '__name__', str(_nb_ann)))
                    _nb_item = {{'type': _nb_type, 'description': _nb_p.name}}
                    if _nb_p.default is not _nb_p.empty:
                        _nb_item['default'] = repr(_nb_p.default)[:100]
                    _nb_params[_nb_p.name] = _nb_item
                _nb_out[_nb_name] = {{'docstring': (_nb_inspect.getdoc(_nb_obj) or '')[:1000], 'parameters': _nb_params}}
                # Compare objects, never identifier strings: imported aliases
                # work, while a user function with the same name stays ordinary.
                import importlib as _nb_importlib
                try:
                    _nb_builtin = _nb_importlib.import_module('nbinlineai.tools')
                    _nb_specials = getattr(_nb_builtin, 'SPECIAL_TOOL_FUNCTIONS', {{}})
                except ImportError:
                    _nb_specials = {{}}
                for _nb_canonical, _nb_registered in _nb_specials.items():
                    if _nb_obj is _nb_registered:
                        _nb_out[_nb_name]['frontend_special'] = _nb_canonical
                        break
            else:
                _nb_out[_nb_name] = {{'type': type(_nb_obj).__name__, 'repr': repr(_nb_obj)[:2000]}}
    elif {operation!r} == 'call':
        _nb_name = _nb_payload['name']
        _nb_obj = _nb_ns.get(_nb_name)
        if not callable(_nb_obj):
            raise TypeError('Registered function is no longer callable')
        _nb_kwargs = _nb_payload['arguments']
        if not isinstance(_nb_kwargs, dict):
            raise TypeError('Tool arguments must be an object')
        _nb_inspect.signature(_nb_obj).bind(**_nb_kwargs)
        _nb_capture = _nb_io.StringIO()
        with _nb_ctx.redirect_stdout(_nb_capture):
            _nb_result = _nb_obj(**_nb_kwargs)
        if _nb_inspect.isawaitable(_nb_result):
            getattr(_nb_result, 'close', lambda: None)()
            raise TypeError('Async tool functions are not supported')
        _nb_out = {{'text': (_nb_capture.getvalue() + repr(_nb_result))[:{MAX_RESULT_CHARS}]}}
except Exception as _nb_exc:
    _nb_out = {{'error': type(_nb_exc).__name__ + ': ' + str(_nb_exc)[:500]}}
print({MARKER!r} + _nb_json.dumps(_nb_out, default=str))
"""
    bridge_name = f"_nbinlineai_bridge_{uuid.uuid4().hex}"
    return f"def {bridge_name}():\n{textwrap.indent(source, '    ')}\n{bridge_name}()\ndel {bridge_name}\n"


class KernelDispatcher:
    def __init__(self, session_manager, kernel_manager):
        self.sessions = session_manager
        self.kernels = kernel_manager
        self._locks: dict[str, asyncio.Lock] = {}

    def preview_ready(self, kernel_id: str, kernel) -> bool:
        lock = self._locks.get(kernel_id)
        return getattr(kernel, "execution_state", None) == "idle" and not (lock and lock.locked())

    @staticmethod
    def _foreign_execution(msg: dict, msg_id: str) -> bool:
        if msg.get("parent_header", {}).get("msg_id") == msg_id:
            return False
        return msg.get("msg_type") == "execute_input" or (
            msg.get("msg_type") == "status" and
            msg.get("content", {}).get("execution_state") == "busy"
        )

    async def _await_preview_status(self, client, kernel, msg_id: str, manager_idle: asyncio.Event):
        """Wait for the server manager status to catch up after inspection."""
        deadline = asyncio.get_running_loop().time() + PREVIEW_STATUS_TIMEOUT
        idle_task = asyncio.create_task(manager_idle.wait())
        message_task = None
        try:
            while not idle_task.done():
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise ValueError("Kernel is busy; refresh the context preview when it is idle")
                message_task = asyncio.create_task(client.get_iopub_msg(timeout=remaining))
                done, _ = await asyncio.wait(
                    (idle_task, message_task), timeout=remaining, return_when=asyncio.FIRST_COMPLETED,
                )
                if message_task in done:
                    try:
                        message = message_task.result()
                    except (Empty, asyncio.QueueEmpty, TimeoutError) as exc:
                        raise ValueError(
                            "Kernel is busy; refresh the context preview when it is idle"
                        ) from exc
                    if self._foreign_execution(message, msg_id):
                        raise ValueError("Kernel is busy; refresh the context preview when it is idle")
                if not done:
                    raise ValueError("Kernel is busy; refresh the context preview when it is idle")
                if not message_task.done():
                    message_task.cancel()
                    await asyncio.gather(message_task, return_exceptions=True)
                message_task = None
            # A manager transition may already have been observed when this
            # coroutine starts. Still inspect IOPub messages queued after our
            # own idle, including a foreign execution that finished quickly.
            for _ in range(32):
                try:
                    msg = await client.get_iopub_msg(timeout=0)
                except (Empty, asyncio.QueueEmpty):
                    break
                if self._foreign_execution(msg, msg_id):
                    raise ValueError("Kernel is busy; refresh the context preview when it is idle")
            else:
                raise ValueError("Kernel is busy; refresh the context preview when it is idle")
            if getattr(kernel, "execution_state", None) != "idle":
                raise ValueError("Kernel is busy; refresh the context preview when it is idle")
        finally:
            idle_task.cancel()
            if message_task is not None:
                message_task.cancel()
            pending = (idle_task, message_task) if message_task is not None else (idle_task,)
            await asyncio.gather(*pending, return_exceptions=True)

    async def resolve(self, session_id: str):
        if not isinstance(session_id, str) or not session_id:
            raise HTTPError(400, "session_id is required")
        try:
            session = await self.sessions.get_session(session_id=session_id)
        except HTTPError as exc:
            raise HTTPError(404, "Notebook session not found") from exc
        if session.get("type") != "notebook":
            raise HTTPError(400, "A notebook session is required")
        kernel_info = session.get("kernel") or {}
        kernel_id = kernel_info.get("id")
        if not kernel_id or kernel_id not in self.kernels:
            raise HTTPError(404, "Notebook kernel is unavailable")
        kernel = self.kernels.get_kernel(kernel_id)
        if (kernel_info.get("name") or "").lower() not in ("python3", "python"):
            # A custom Python kernelspec can have a different name; inspect language.
            try:
                spec = self.kernels.kernel_spec_manager.get_kernel_spec(kernel_info.get("name"))
                if spec.language.lower() != "python":
                    raise HTTPError(400, "Only Python kernels are supported")
            except HTTPError:
                raise
            except Exception as exc:
                raise HTTPError(400, "Only Python kernels are supported") from exc
        return kernel_id, kernel

    async def execute(self, kernel_id: str, kernel, operation: str, payload: dict, timeout: float = 20,
                      *, require_idle: bool = False):
        lock = self._locks.setdefault(kernel_id, asyncio.Lock())
        if require_idle and not self.preview_ready(kernel_id, kernel):
            raise ValueError("Kernel is busy; refresh the context preview when it is idle")
        async with lock:
            if require_idle and getattr(kernel, "execution_state", None) != "idle":
                raise ValueError("Kernel is busy; refresh the context preview when it is idle")
            client = kernel.client()
            client.start_channels()
            msg_id = None
            busy = False
            manager_idle = asyncio.Event() if require_idle else None
            manager_busy = False
            observing_state = False

            def observe_execution_state(change):
                nonlocal manager_busy
                if change["new"] == "busy":
                    manager_busy = True
                elif change["new"] == "idle" and manager_busy:
                    manager_idle.set()

            try:
                if require_idle:
                    kernel.observe(observe_execution_state, names="execution_state")
                    observing_state = True
                msg_id = client.execute(_payload_code(operation, payload), silent=True, store_history=False,
                                        allow_stdin=False, stop_on_error=True)
                output = None
                async with asyncio.timeout(timeout):
                    while True:
                        msg = await client.get_iopub_msg(timeout=timeout)
                        if msg.get("parent_header", {}).get("msg_id") != msg_id:
                            if require_idle and self._foreign_execution(msg, msg_id):
                                raise ValueError("Kernel is busy; refresh the context preview when it is idle")
                            continue
                        kind = msg.get("msg_type")
                        content = msg.get("content", {})
                        if kind == "status" and content.get("execution_state") == "busy":
                            busy = True
                        if kind == "stream":
                            for line in content.get("text", "").splitlines():
                                if line.startswith(MARKER):
                                    output = json.loads(line[len(MARKER):])
                        elif kind == "error":
                            raise RuntimeError(content.get("evalue", "Kernel execution failed")[:500])
                        elif kind == "status" and content.get("execution_state") == "idle":
                            busy = False
                            break
                    while True:
                        reply = await client.get_shell_msg(timeout=timeout)
                        if reply.get("parent_header", {}).get("msg_id") == msg_id:
                            if reply.get("content", {}).get("status") != "ok":
                                raise RuntimeError("Kernel execution failed")
                            break
                    if require_idle:
                        await self._await_preview_status(client, kernel, msg_id, manager_idle)
                if output is None:
                    raise RuntimeError("Kernel did not return an introspection result")
                return output
            except asyncio.CancelledError:
                if busy:
                    await kernel.interrupt_kernel()
                raise
            except TimeoutError:
                if busy:
                    await kernel.interrupt_kernel()
                raise
            finally:
                try:
                    if observing_state:
                        kernel.unobserve(observe_execution_state, names="execution_state")
                finally:
                    client.stop_channels()

    async def inspect(self, kernel_id: str, kernel, variables: list[str], functions: list[str]):
        names = list(dict.fromkeys([*variables, *functions]))
        if any(not IDENTIFIER.fullmatch(name) for name in names):
            raise HTTPError(400, "Invalid Python name")
        return await self.execute(kernel_id, kernel, "inspect", {"names": names, "functions": functions})

    async def inspect_preview(self, kernel_id: str, kernel, variables: list[str], functions: list[str]):
        names = list(dict.fromkeys([*variables, *functions]))
        if any(not IDENTIFIER.fullmatch(name) for name in names):
            raise HTTPError(400, "Invalid Python name")
        return await self.execute(kernel_id, kernel, "inspect", {"names": names, "functions": functions},
                                  timeout=5, require_idle=True)

    async def call(self, session_id: str, kernel_id: str, kernel, allowed: set[str], name: str, arguments):
        current_id, current_kernel = await self.resolve(session_id)
        if current_id != kernel_id or current_kernel is not kernel:
            raise ValueError("Notebook session changed kernels during the prompt")
        if name not in allowed or not IDENTIFIER.fullmatch(name):
            raise ValueError("Tool is not registered for this prompt")
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except ValueError as exc:
                raise ValueError("Tool arguments are invalid JSON") from exc
        if not isinstance(arguments, dict) or len(json.dumps(arguments)) > 16000:
            raise ValueError("Tool arguments must be a small JSON object")
        if any(not isinstance(key, str) or not IDENTIFIER.fullmatch(key) for key in arguments):
            raise ValueError("Tool argument name is invalid")
        result = await self.execute(kernel_id, kernel, "call", {"name": name, "arguments": arguments}, timeout=30)
        if "error" in result:
            raise ValueError(result["error"])
        return result["text"][:MAX_RESULT_CHARS]
