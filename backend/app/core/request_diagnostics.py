"""Attach request references and look up troubleshooting steps in memory."""

import logging
import re
from time import perf_counter
from traceback import walk_tb
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.error_catalog import CATALOG, ERROR_CODE, REQUEST_ID, http_error_code
from app.core.production_errors import operation_error_code


logger = logging.getLogger(__name__)
METRICS = {"requests_total": 0, "errors_total": 0, "route_counts": {}, "route_errors": {}, "route_latency_ms": {}}


def response_error_code(scope: Scope, status: int) -> str:
    if status == 500:
        code = operation_error_code(scope.get("endpoint"))
        if code is not None:
            return code
    return http_error_code(status)


async def coded_http_exception_handler(request: Request, exc: HTTPException):
    response = await http_exception_handler(request, exc)
    if isinstance(exc.detail, dict):
        code = exc.detail.get("code")
        if isinstance(code, str) and code in CATALOG:
            response.headers[ERROR_CODE] = code
    if exc.status_code >= 500:
        request.state.diagnostic_exception = exc.__cause__ or exc
    return response


def log_diagnosis(
    scope: Scope, request_id: str, code: str, status: int, exc: Exception | None = None,
    *, affected_components: int | None = None,
) -> None:
    route = getattr(scope.get("route"), "path", "<unmatched>")
    context = f" affected_components={affected_components}" if affected_components is not None else ""
    level = logging.WARNING if affected_components is not None else logging.INFO
    if exc is not None:
        # Use call locations without exception text, argument values, or source lines.
        frames = list(walk_tb(exc.__traceback__))
        locations = " <- ".join(
            f"{frame.f_code.co_filename}:{line}:{frame.f_code.co_name}"
            for frame, line in reversed(frames[-8:])
        )
        context += f" exception_type={type(exc).__name__} stack={locations!r}"
    logger.log(
        logging.ERROR if status >= 500 or exc is not None else level,
        "request_diagnosis error_code=%s request_id=%s method=%s route=%s status=%s action=%s%s",
        code, request_id, scope["method"], route, status, CATALOG[code][1], context,
    )


def mark_partial_failure(request: Request, code: str, affected_components: int) -> None:
    """Record a successful HTTP response that contains per-component failures."""
    request.state.partial_failure = (code, affected_components)


class RequestDiagnosticsMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        supplied_id = Headers(scope=scope).get(REQUEST_ID, "")
        request_id = supplied_id if re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", supplied_id) else uuid4().hex
        started_at = perf_counter()
        response_started = False
        response_status = 500
        stream_failed = False
        failure = None

        async def send_with_diagnostics(message: Message) -> None:
            nonlocal response_status, response_started
            if message["type"] == "http.response.start":
                response_started = True
                response_status = message["status"]
                headers = MutableHeaders(scope=message)
                headers[REQUEST_ID] = request_id
                if 400 <= response_status <= 599:
                    code = headers.get(ERROR_CODE)
                    if code not in CATALOG:
                        code = response_error_code(scope, response_status)
                    headers[ERROR_CODE] = code
                    exc = failure or scope.get("state", {}).get("diagnostic_exception")
                    log_diagnosis(scope, request_id, code, response_status, exc)
                elif 200 <= response_status < 300:
                    partial_failure = scope.get("state", {}).get("partial_failure")
                    if partial_failure is not None:
                        code, affected_components = partial_failure
                        headers[ERROR_CODE] = code
                        log_diagnosis(
                            scope, request_id, code, response_status, affected_components=affected_components,
                        )
            await send(message)

        try:
            await self.app(scope, receive, send_with_diagnostics)
        except Exception as exc:
            if response_started:
                stream_failed = True
                log_diagnosis(scope, request_id, "RESPONSE_INTERRUPTED", response_status, exc)
                raise
            failure = exc
            response = JSONResponse(status_code=500, content={
                "detail": "Internal server error",
                "type": type(exc).__name__,
                "error_code": response_error_code(scope, 500),
                "request_id": request_id,
            })
            await response(scope, receive, send_with_diagnostics)
        finally:
            elapsed_ms = round((perf_counter() - started_at) * 1000, 2)
            route_key = f"{scope['method']} {scope['path']}"
            METRICS["requests_total"] += 1
            METRICS["route_counts"][route_key] = METRICS["route_counts"].get(route_key, 0) + 1
            METRICS["route_latency_ms"][route_key] = elapsed_ms
            if response_status >= 500 or stream_failed:
                METRICS["errors_total"] += 1
                METRICS["route_errors"][route_key] = METRICS["route_errors"].get(route_key, 0) + 1
            logger.info(
                "request_completed request_id=%s method=%s path=%r status=%s duration_ms=%s",
                request_id, scope["method"], scope["path"], response_status, elapsed_ms,
            )


def install_request_diagnostics(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, coded_http_exception_handler)
    app.add_middleware(RequestDiagnosticsMiddleware)
