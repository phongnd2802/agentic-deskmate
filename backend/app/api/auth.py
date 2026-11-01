"""Auth routes: sign-in, sign-out and the current User."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.schemas.auth import CurrentUserOut, OrganizationOut, SignInRequest
from app.services.auth import CurrentUser, InvalidCredentials, current_user, sign_in, sign_out
from app.settings import SESSION_COOKIE, settings

router = APIRouter()


def _to_out(user: CurrentUser) -> CurrentUserOut:
    return CurrentUserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        locale=user.locale,
        organization=OrganizationOut(id=user.organization_id, name=user.organization_name),
    )


@router.post("/auth/sign-in", response_model=CurrentUserOut)
async def sign_in_route(body: SignInRequest, response: Response) -> CurrentUserOut:
    try:
        token, user = await sign_in(body.email, body.password)
    except InvalidCredentials:
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    return _to_out(user)


@router.post("/auth/sign-out", status_code=204)
async def sign_out_route(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await sign_out(token)
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/auth/me", response_model=CurrentUserOut)
async def me(user: CurrentUser = Depends(current_user)) -> CurrentUserOut:
    return _to_out(user)
