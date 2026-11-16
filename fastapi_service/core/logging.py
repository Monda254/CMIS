"""
Structured Logging Configuration for IBMS API (Section 18).
"""

from __future__ import annotations

import logging
import sys


def configure_logging() -> logging.Logger:
    logger = logging.getLogger("ibms.api")
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        formatter = logging.Formatter(
            fmt="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger
