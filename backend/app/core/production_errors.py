"""Explicit productionized errors for removed demo fallback paths."""

from __future__ import annotations

from fastapi import HTTPException


def database_unavailable(message: str = "Database is unavailable") -> HTTPException:
    return HTTPException(status_code=503, detail={"code": "DATABASE_UNAVAILABLE", "message": message})


def graph_unavailable(message: str = "Graph backend is unavailable") -> HTTPException:
    return HTTPException(status_code=503, detail={"code": "GRAPH_UNAVAILABLE", "message": message})


def seed_data_required(message: str = "Required seed data is missing. Run the explicit seed script before using this endpoint.") -> HTTPException:
    return HTTPException(status_code=409, detail={"code": "SEED_DATA_REQUIRED", "message": message})
