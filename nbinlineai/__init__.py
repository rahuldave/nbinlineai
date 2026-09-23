"""JupyterLab AI prompt-cell extension."""

from .handlers import setup_handlers

__version__ = "0.1.7"


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "nbinlineai"}]


def _jupyter_server_extension_points():
    return [{"module": "nbinlineai"}]


def _load_jupyter_server_extension(server_app):
    setup_handlers(server_app.web_app)
    server_app.log.info("nbinlineai server extension loaded")
