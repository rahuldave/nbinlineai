import pytest

from nbinlineai.tool_schema import fastllm_tool, fastllm_tools


def test_ai_jup_introspection_maps_to_fastllm_and_native_provider_schemas():
    from fastllm.anthropic import denorm_tool_schs as anthropic_tools
    from fastllm.openai_chat import denorm_tool_schs as openai_chat_tools
    from fastllm.openai_responses import denorm_tool_schs as openai_tools
    from fastllm.types import fn_schema

    info = {
        "docstring": "Calculate revenue.",
        "parameters": {
            "units": {"type": "int", "description": "Number of units"},
            "price": {"type": "float", "description": "Unit price"},
            "discount": {"type": "float", "description": "Discount", "default": "0.0"},
        },
    }
    tool = fastllm_tool("revenue", info)
    name, description, schema = fn_schema(tool)

    assert name == "revenue"
    assert description == "Calculate revenue."
    assert schema["required"] == ["units", "price"]
    assert schema["properties"]["units"]["type"] == "integer"
    assert schema["properties"]["price"]["type"] == "number"
    assert anthropic_tools([tool])[0]["input_schema"] == schema
    assert openai_tools([tool])[0] == tool
    assert openai_chat_tools([tool])[0]["function"]["strict"] is False


def test_only_selected_functions_become_tools():
    tools = fastllm_tools({"analyze": {"parameters": {}}, "summarize": {"parameters": {}}})
    assert [tool["name"] for tool in tools] == ["analyze", "summarize"]


@pytest.mark.parametrize("name", ["x.y", "__import__('os')", "with space"])
def test_rejects_non_identifier_tool_names(name):
    with pytest.raises(ValueError, match="Invalid function name"):
        fastllm_tool(name, {"parameters": {}})


def test_typing_aliases_and_unknown_types():
    tool = fastllm_tool(
        "sample",
        {
            "parameters": {
                "items": {"type": "typing.List[int]"},
                "options": {"type": "typing.Dict[str, int]"},
                "custom": {"type": "MyClass"},
            }
        },
    )
    properties = tool["parameters"]["properties"]
    assert properties["items"]["type"] == "array"
    assert properties["options"]["type"] == "object"
    assert properties["custom"]["type"] == "string"
