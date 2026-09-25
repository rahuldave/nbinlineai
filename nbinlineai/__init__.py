"""JupyterLab AI prompt-cell extension."""

from jupyter_server.extension.application import ExtensionApp

from .handlers import setup_handlers

__version__ = "0.1.14"


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "nbinlineai"}]


def _jupyter_server_extension_points():
    return [{"module": "nbinlineai", "app": NbinlineaiExtension}]


def _load_jupyter_server_extension(server_app):
    from .subscription_runtime import get_subscription_runtime

    web_app = server_app.web_app
    manager = web_app.settings.get("nbinlineai_subscription_manager")
    if manager is None:
        manager = get_subscription_runtime()
        web_app.settings["nbinlineai_subscription_manager"] = manager
    setup_handlers(web_app, subscription_manager=manager)
    server_app.log.info("nbinlineai server extension loaded")


class NbinlineaiExtension(ExtensionApp):
    """Use Jupyter Server's awaited extension shutdown hook for owned children."""

    name = "nbinlineai"

    def _jupyter_server_config(self):
        return {}

    def initialize_handlers(self):
        _load_jupyter_server_extension(self.serverapp)

    async def stop_extension(self):
        manager = self.serverapp.web_app.settings.get("nbinlineai_subscription_manager")
        if manager is not None:
            await manager.close()
