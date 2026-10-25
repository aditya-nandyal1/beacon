"""Shared message models + a local-first resolver for the Beacon helper mesh."""
from __future__ import annotations
from typing import Dict, List, Optional
from uagents import Model
from uagents.resolver import GlobalResolver, Resolver


class ResponderRegister(Model):
    responder_id: str
    name: str
    skills: List[str]
    lat: float
    lng: float
    available: bool = True
    endpoint: str  # where this responder can be reached directly


class HelpRequest(Model):
    request_id: str
    incident_id: str
    situation: str
    severity: str
    summary: str
    lat: float
    lng: float
    distance_m: float
    live_link: str


class HelpResponse(Model):
    request_id: str
    incident_id: str
    responder_id: str
    name: str
    status: str  # accepted | declined | arrived
    eta_sec: Optional[int] = None


class LocalFirstResolver(Resolver):
    """Resolve peers we already know by endpoint; fall back to the Almanac for anyone else."""
    def __init__(self, rules: Dict[str, str]):
        self.rules = rules
        self.fallback = GlobalResolver()

    async def resolve(self, destination: str):
        if destination in self.rules:
            return destination, [self.rules[destination]]
        return await self.fallback.resolve(destination)
