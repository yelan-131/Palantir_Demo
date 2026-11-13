"""Tool definitions and dispatch shared by the registry and Harness."""

from .application_admin_tools import APPLICATION_REQUESTS, APPLICATION_TOOL_DETAILS, execute_application_tool
from .menu_admin_tools import MENU_REQUESTS, MENU_TOOL_DETAILS, execute_menu_tool

REQUESTS = {**APPLICATION_REQUESTS, **MENU_REQUESTS}
DETAILS = {**APPLICATION_TOOL_DETAILS, **MENU_TOOL_DETAILS}
SNAPSHOT_FIELDS = {
    **dict.fromkeys(APPLICATION_REQUESTS, "_application_snapshot"),
    **dict.fromkeys(MENU_REQUESTS, "_menu_snapshot"),
}


def registry_definitions():
    return {
        name: {
            "name": name,
            "title": DETAILS[name][0],
            "description": DETAILS[name][1],
            "handler_key": name,
            "side_effect": "configuration_write",
            "risk_level": "high",
            "input_schema": request.model_json_schema(),
            "permission_check": "config",
            "dry_run_supported": False,
            "audit_required": True,
        }
        for name, request in REQUESTS.items()
    }


async def execute_application_menu_tool(operation, session, *, user, payload, prepare=False):
    execute = execute_application_tool if operation in APPLICATION_REQUESTS else execute_menu_tool
    return await execute(operation, session, user=user, payload=payload, prepare=prepare)
