"""Outbound calls to a Provider's base URL must not reach private infrastructure (SSRF).

Server configuration can allow networks. The check runs when a Provider is saved and again on every
connection the backend opens to it, on every address the name resolves to.
"""

import asyncio
import ipaddress
import socket
from functools import cache
from urllib.parse import urlsplit

import httpx2
from httpcore2._backends.auto import AutoBackend
from pydantic_ai.models import create_async_httpx2_client

from app.settings import settings


class BlockedAddress(Exception):
    """Carries a message that is safe to show an Admin."""


_NAT64 = ipaddress.ip_network("64:ff9b::/96")
_V4_COMPATIBLE = ipaddress.ip_network("::/96")


def _embedded_ipv4(address: ipaddress.IPv6Address) -> ipaddress.IPv4Address | None:
    """The IPv4 address an IPv6 one carries (mapped, NAT64, IPv4-compatible or 6to4), which is what it really reaches."""
    if address.ipv4_mapped:
        return address.ipv4_mapped
    if address.sixtofour:
        return address.sixtofour
    if address in _NAT64 or (address in _V4_COMPATIBLE and int(address) > 1):
        return ipaddress.IPv4Address(address.packed[-4:])
    return None


def _allowed(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if any(address.version == n.version and address in n for n in _networks()):
        return True
    if isinstance(address, ipaddress.IPv6Address) and (embedded := _embedded_ipv4(address)):
        return _allowed(embedded)
    # is_global alone still lets multicast, reserved and some embedded forms through on Python 3.12, so those are refused too.
    return address.is_global and not (address.is_multicast or address.is_reserved or address.is_unspecified)


def _networks() -> list:
    return [ipaddress.ip_network(n.strip()) for n in settings.provider_allowed_networks.split(",") if n.strip()]


async def resolve_allowed(host: str, port: int) -> list[str]:
    """Every address the host resolves to, or BlockedAddress if any of them is not allowed."""
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        raise ValueError(f"The address {host} could not be resolved.") from None
    addresses = [info[4][0].split("%")[0] for info in infos]
    for address in addresses:
        if not _allowed(ipaddress.ip_address(address)):
            raise BlockedAddress(
                f"{host} resolves to a private or loopback address. Ask the Operator to allow its network in the server configuration."
            )
    return addresses


async def check_base_url(url: str) -> None:
    """Raises ValueError for an unusable or unresolvable URL and BlockedAddress for a forbidden destination."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        raise ValueError("The base URL must be an http or https address without credentials.")
    await resolve_allowed(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))


class _CheckedBackend(AutoBackend):
    async def connect_tcp(self, host, port, *args, **kwargs):
        # The connection goes to the address that was just checked, not to a second lookup of the name, so DNS
        # rebinding cannot swap it. TLS still verifies the certificate against the original host name.
        [address, *_] = await resolve_allowed(host, port)
        return await super().connect_tcp(address, port, *args, **kwargs)


class _CheckedTransport(httpx2.AsyncHTTPTransport):
    def __init__(self) -> None:
        # trust_env=False: no proxy from the environment may carry the call somewhere else.
        # No idle connections kept: calls are long streams, and a pooled socket would outlive the loop that opened it.
        super().__init__(trust_env=False, limits=httpx2.Limits(max_keepalive_connections=0))
        self._pool._network_backend = _CheckedBackend()  # shortcut: private attribute of httpcore2's pool, recheck on upgrade


@cache
def checked_http_client() -> httpx2.AsyncClient:
    """The one HTTP client for Provider calls, shared so a run never leaks its own. Redirects are not followed."""
    return create_async_httpx2_client(transport=_CheckedTransport())
