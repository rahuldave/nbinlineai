"""Catalog groups use the existing execution-bound declaration insertion."""

import pytest

from nbinlineai import tools


@pytest.mark.parametrize("group", [None, *tools.TOOL_GROUPS])
def test_catalog_insertion_selects_group_and_returns_receipt(monkeypatch, group):
    """Offer exactly the selected group's functions through the normal comm path."""
    sent = []
    receipt = object()

    def request(markdown):
        sent.append(markdown)
        return receipt

    monkeypatch.setattr(tools, "request_insert_tools", request)
    result = tools.insert_tool_catalog() if group is None else tools.insert_tool_catalog(group)
    selected = "starter" if group is None else group
    assert result is receipt
    assert sent == [tools.tools_markdown(group=selected)]
    assert sent[0].count("&`") == len(tools.TOOL_GROUPS[selected])
    assert "insert_tool_catalog" in tools.__all__
    assert "insert_tool_catalog" not in tools.TOOL_FUNCTIONS


@pytest.mark.parametrize("group", ["", "missing", None, [], 1])
def test_invalid_catalog_group_never_requests_insertion(monkeypatch, group):
    """Invalid groups fail before asking the frontend to change a notebook."""
    def unexpected_request(markdown):
        pytest.fail("Invalid groups must not open a comm")

    monkeypatch.setattr(tools, "request_insert_tools", unexpected_request)
    with pytest.raises(ValueError, match="Unknown tool group"):
        tools.insert_tool_catalog(group)
