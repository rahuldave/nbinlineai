"""Server endpoint used to verify that the Python extension is active."""

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado.web import authenticated


class StatusHandler(APIHandler):
    @authenticated
    def get(self):
        self.finish({"extension": "nbinlineai", "status": "ready"})


def setup_handlers(web_app):
    base_url = web_app.settings["base_url"]
    route = url_path_join(base_url, "nbinlineai", "status")
    web_app.add_handlers(r".*$", [(route, StatusHandler)])
