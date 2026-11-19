"""Domain HTTP errors and labels for unexpected operation failures."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import HTTPException

from app.core.error_catalog import CATALOG, ERROR_CODE


def diagnose_operation(code: str):
    """Mark an operation with the fallback code for its unexpected failures."""
    if code not in CATALOG:
        raise ValueError(f"Unregistered diagnostic code: {code}")

    def mark(operation: Callable) -> Callable:
        setattr(operation, "diagnostic_error_code", code)
        return operation

    return mark


def operation_error_code(operation) -> str | None:
    return getattr(operation, "diagnostic_error_code", None)


def coded_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail=message, headers={ERROR_CODE: code})


def database_unavailable(message: str = "Database is unavailable") -> HTTPException:
    return HTTPException(status_code=503, detail={"code": "DATABASE_UNAVAILABLE", "message": message})


def graph_unavailable(message: str = "Graph backend is unavailable") -> HTTPException:
    return HTTPException(status_code=503, detail={"code": "GRAPH_UNAVAILABLE", "message": message})


def seed_data_required(message: str = "Required seed data is missing. Run the explicit seed script before using this endpoint.") -> HTTPException:
    return HTTPException(status_code=409, detail={"code": "SEED_DATA_REQUIRED", "message": message})
