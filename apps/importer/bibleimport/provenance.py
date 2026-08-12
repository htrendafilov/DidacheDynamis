"""Shared structural validation for commentary producer provenance."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping

_SHA256 = re.compile(r"^[0-9a-f]{64}$")

PROVENANCE_FIELDS = (
    "model_request_id",
    "model_canonical_slug",
    "model_returned",
    "prompt_hash",
    "glossary_hash",
    "settings_json",
    "run_id",
    "translated_at",
)

# A source import uses run_id to identify the offline importer invocation. Every other field is
# specifically about a translation/model run, so any one of them makes this machine provenance and
# requires the complete M2 record. The id prefix is then checked for consistency; it never decides
# which validation path applies.
_MACHINE_SIGNAL_FIELDS = tuple(field for field in PROVENANCE_FIELDS if field != "run_id")


def validate_provenance_metadata(
    provenance_id: str,
    fields: Mapping[str, str | None],
    *,
    where: str,
) -> None:
    """Validate source versus machine provenance from its data, not its caller-chosen id."""
    values = {field: fields.get(field) for field in PROVENANCE_FIELDS}
    for field, value in values.items():
        if value is not None and (not isinstance(value, str) or not value):
            raise TypeError(f"{where}: {field} must be a non-empty string")
    if not any(value is not None for value in values.values()):
        raise ValueError(f"{where}: provenance {provenance_id!r} has no producer metadata")

    is_machine = any(values[field] is not None for field in _MACHINE_SIGNAL_FIELDS)
    if not is_machine:
        if not provenance_id.startswith("src:"):
            raise ValueError(
                f"{where}: source provenance {provenance_id!r} must use the 'src:' prefix"
            )
        return

    missing = [field for field, value in values.items() if value is None]
    if missing:
        raise ValueError(
            f"{where}: machine provenance {provenance_id!r} is missing " + ", ".join(missing)
        )
    if provenance_id.startswith("src:"):
        raise ValueError(
            f"{where}: machine provenance {provenance_id!r} cannot use the 'src:' prefix"
        )
    for field in ("prompt_hash", "glossary_hash"):
        if not _SHA256.fullmatch(values[field] or ""):
            raise ValueError(f"{where}: {field} must be a lowercase sha256")
    try:
        settings = json.loads(values["settings_json"] or "")
    except json.JSONDecodeError as exc:
        raise ValueError(f"{where}: settings_json is not valid JSON") from exc
    if not isinstance(settings, dict):
        raise TypeError(f"{where}: settings_json must encode an object")
