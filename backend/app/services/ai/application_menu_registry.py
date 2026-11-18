"""Tool definitions and dispatch shared by the registry and Harness."""

from .application_admin_tools import APPLICATION_REQUESTS, APPLICATION_TOOL_DETAILS, execute_application_tool
from .menu_admin_tools import MENU_REQUESTS, MENU_TOOL_DETAILS, execute_menu_tool
from .application_workspace_tools import READ_TOOLS, WORKSPACE_DETAILS, WORKSPACE_REQUESTS, execute_workspace_tool

LEGACY_REQUESTS = {**APPLICATION_REQUESTS, **MENU_REQUESTS}
REQUESTS = {**LEGACY_REQUESTS, **WORKSPACE_REQUESTS}
WRITE_REQUESTS = {name: request for name, request in REQUESTS.items() if name not in READ_TOOLS}
DETAILS = {**APPLICATION_TOOL_DETAILS, **MENU_TOOL_DETAILS, **WORKSPACE_DETAILS}
SNAPSHOT_FIELDS = {
    **dict.fromkeys(APPLICATION_REQUESTS, "_application_snapshot"),
    **dict.fromkeys(MENU_REQUESTS, "_menu_snapshot"),
    **dict.fromkeys(WORKSPACE_REQUESTS.keys() - READ_TOOLS, "_workspace_snapshot"),
}


def registry_definitions():
    return {
        name: {
            "name": name,
            "title": DETAILS[name][0],
            "description": DETAILS[name][1],
            "handler_key": name,
            "side_effect": "read" if name in READ_TOOLS else "configuration_write",
            "risk_level": "low" if name in READ_TOOLS else "high",
            "input_schema": request.model_json_schema(),
            "permission_check": "config",
            "dry_run_supported": False,
            "audit_required": name not in READ_TOOLS,
        }
        for name, request in REQUESTS.items()
    }


async def execute_application_menu_tool(operation, session, *, user, payload, prepare=False):
    if operation in WORKSPACE_REQUESTS:
        return await execute_workspace_tool(operation, session, user=user, payload=payload, prepare=prepare)
    execute = execute_application_tool if operation in APPLICATION_REQUESTS else execute_menu_tool
    return await execute(operation, session, user=user, payload=payload, prepare=prepare)
