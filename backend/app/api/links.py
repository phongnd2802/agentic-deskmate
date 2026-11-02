"""Invitations, password resets and the user list. Creating and listing are Admin only; using a link needs no session."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response

from app.schemas.links import AcceptIn, InvitationIn, LinkOut, LinkPreviewOut, UserOut
from app.services import links
from app.services.auth import CurrentUser, admin_user

router = APIRouter()


def _error(status: int, code: str, message: str) -> HTTPException:
    # Stable codes: the pages translate them. The English message is only a fallback.
    return HTTPException(status_code=status, detail={"code": code, "message": message})


_REFUSED = {
    "link_invalid": (404, "This link is not valid."),
    "link_used": (410, "This link has already been used."),
    "link_expired": (410, "This link has expired."),
}


async def _translating_errors(call):
    try:
        return await call
    except links.LinkRefused as e:
        raise _error(_REFUSED[e.reason][0], e.reason, _REFUSED[e.reason][1])
    except links.EmailTaken:
        raise _error(409, "email_taken", "This email is already in use.")
    except links.UserNotFound:
        raise HTTPException(status_code=404, detail="User not found")


@router.get("/users", response_model=list[UserOut])
async def list_users(user: CurrentUser = Depends(admin_user)):
    return await links.list_users(user)


@router.post("/invitations", response_model=LinkOut, status_code=201)
async def create_invitation(body: InvitationIn, user: CurrentUser = Depends(admin_user)):
    token, expires_at = await _translating_errors(links.create_invitation(user, body.email))
    return LinkOut(token=token, expires_at=expires_at)


@router.post("/users/{user_id}/password-reset", response_model=LinkOut, status_code=201)
async def create_password_reset(user_id: UUID, user: CurrentUser = Depends(admin_user)):
    token, expires_at = await _translating_errors(links.create_password_reset(user, user_id))
    return LinkOut(token=token, expires_at=expires_at)


@router.get("/invitations/{token}", response_model=LinkPreviewOut)
async def show_invitation(token: str):
    organization_name, email = await _translating_errors(links.preview(token, "invitation"))
    return LinkPreviewOut(organization_name=organization_name, email=email)


@router.post("/invitations/{token}/accept", status_code=204)
async def accept_invitation(token: str, body: AcceptIn):
    await _translating_errors(links.accept(token, "invitation", body.password))
    return Response(status_code=204)


@router.get("/password-resets/{token}", response_model=LinkPreviewOut)
async def show_password_reset(token: str):
    organization_name, email = await _translating_errors(links.preview(token, "reset"))
    return LinkPreviewOut(organization_name=organization_name, email=email)


@router.post("/password-resets/{token}/accept", status_code=204)
async def accept_password_reset(token: str, body: AcceptIn):
    await _translating_errors(links.accept(token, "reset", body.password))
    return Response(status_code=204)
