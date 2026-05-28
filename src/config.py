import os
from dataclasses import dataclass

DEFAULT_API_PORT = int(os.environ.get("API_PORT", "8888"))
DEFAULT_PUBLIC_API_HOST = "127.0.0.1"
DEFAULT_BIND_HOST = "0.0.0.0"
DEFAULT_PUBLIC_API_BASE_URL = (
    f"http://{DEFAULT_PUBLIC_API_HOST}:{DEFAULT_API_PORT}"
)


@dataclass(frozen=True)
class Config:
    model_name: str = os.environ.get("LLM_MODEL", "deepseek-v4-flash")
    model_base_url: str = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com")
    temperature: float = 0
    recursion_limit: int = 1000
    max_sessions: int = 100


CONFIG = Config()
