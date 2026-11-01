"""Provider configuration (Admin only) and the Models any User may pick."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response

from app.db.models import Model, Provider
from app.net import BlockedAddress
from app.schemas.providers import ChoosableModelOut, ModelOut, ProviderIn, ProviderOut
from app.services import providers
from app.services.auth import CurrentUser, admin_user, current_user

router = APIRouter()


def _out(provider: Provider, models: list[Model]) -> ProviderOut:
    return ProviderOut(
        id=provider.id,
        name=provider.name,
        api_type=provider.api_type,
        base_url=provider.base_url,
        models=[ModelOut.model_validate(m, from_attributes=True) for m in models],
    )


def _error(status: int, code: str, message: str) -> HTTPException:
    # Stable codes: the Settings page translates them. The English message is only a fallback.
    return HTTPException(status_code=status, detail={"code": code, "message": message})


async def _translating_errors(call):
    try:
        return await call
    except ValueError as e:
        raise _error(422, "invalid_base_url", str(e))
    except BlockedAddress as e:
        raise _error(422, "blocked_address", str(e))
    except providers.NameTaken:
        raise _error(409, "name_taken", "A Provider with this name already exists.")


@router.get("/providers", response_model=list[ProviderOut])
async def list_providers(user: CurrentUser = Depends(admin_user)):
    return [_out(p, models) for p, models in await providers.list_providers(user)]


@router.post("/providers", response_model=ProviderOut, status_code=201)
async def create_provider(body: ProviderIn, user: CurrentUser = Depends(admin_user)):
    if not body.api_key:
        raise _error(422, "key_required", "An API key is required.")
    return _out(*await _translating_errors(providers.create_provider(user, body)))


@router.put("/providers/{provider_id}", response_model=ProviderOut)
async def update_provider(provider_id: UUID, body: ProviderIn, user: CurrentUser = Depends(admin_user)):
    saved = await _translating_errors(providers.update_provider(user, provider_id, body))
    if saved is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    return _out(*saved)


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(provider_id: UUID, user: CurrentUser = Depends(admin_user)):
    if not await providers.delete_provider(user, provider_id):
        raise HTTPException(status_code=404, detail="Provider not found")
    return Response(status_code=204)


@router.get("/models", response_model=list[ChoosableModelOut])
async def list_models(user: CurrentUser = Depends(current_user)):
    return [
        ChoosableModelOut(id=m.id, provider_name=name, model_id=m.model_id)
        for m, name in await providers.list_models(user)
    ]
