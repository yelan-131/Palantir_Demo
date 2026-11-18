"""Replay confirmation progress independently of the browser connection."""

import asyncio
from typing import Any


class ConfirmationStream:
    def __init__(self, confirmation_token: str | None):
        self.confirmation_token = confirmation_token
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.changed = asyncio.Event()
        self.closed = False
        self.follow_up: asyncio.Task | None = None
        self._undelivered_actions: set[str] = set()

    async def publish(self, event: str, data: dict[str, Any]):
        action_id = data.get("id")
        if action_id and event == "continuation.ui.action":
            self._undelivered_actions.add(action_id)
        elif action_id and event == "continuation.ui.action.cancel":
            self._undelivered_actions.discard(action_id)
        self.events.append((event, data))
        self.changed.set()

    def close(self):
        self.closed = True
        self._undelivered_actions.clear()
        self.events.append(("confirmation.finished", {}))
        self.changed.set()

    async def frames(self, encode):
        offset = 0
        while True:
            while offset < len(self.events):
                event, data = self.events[offset]
                offset += 1
                if event == "continuation.ui.action":
                    # A browser command may already have modified the editor.
                    # A reconnect can receive an undelivered command only.
                    action_id = data.get("id")
                    if action_id not in self._undelivered_actions:
                        continue
                    self._undelivered_actions.remove(action_id)
                yield encode(event, data)
            if self.closed:
                return
            self.changed.clear()
            try:
                await asyncio.wait_for(self.changed.wait(), timeout=15)
            except TimeoutError:
                yield ": keep-alive\n\n"
