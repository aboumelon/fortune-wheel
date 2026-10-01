import json
import uuid

from django.contrib.auth import authenticate, login, logout
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .models import Coupon, Prize, Spin


def api_error(code, status, detail):
    return JsonResponse({"code": code, "detail": detail}, status=status)


def csrf_failure(request, reason=""):
    return api_error("CSRF_FAILED", 403, "CSRF verification failed.")


def _json_object(request):
    try:
        raw = request.body.decode("utf-8")
        data = json.loads(raw or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _unauthorized():
    return api_error("AUTH_REQUIRED", 401, "Authentication is required.")


def _prize_payload(prize):
    return {
        "id": prize.id,
        "slot": prize.slot,
        "name": prize.name,
        "description": prize.description,
        "icon": prize.icon,
        "color": prize.color,
    }


def _spin_prize_payload(spin_record):
    return {
        "id": spin_record.prize_id,
        "slot": spin_record.prize_slot,
        "name": spin_record.prize_name,
        "description": spin_record.prize_description,
        "icon": spin_record.prize_icon,
        "color": spin_record.prize_color,
    }


def _spin_payload(spin_record):
    remaining = Coupon.objects.filter(
        user=spin_record.user, redeemed_at__isnull=True
    ).count()
    return {
        "spinId": str(spin_record.id),
        "requestId": str(spin_record.request_id),
        "prize": _spin_prize_payload(spin_record),
        "remainingCoupons": remaining,
        "createdAt": spin_record.created_at.isoformat(),
    }


def _parse_request_id(raw_value):
    if not raw_value:
        return None
    try:
        return uuid.UUID(str(raw_value))
    except (AttributeError, TypeError, ValueError):
        return None


@require_GET
def csrf(request):
    return JsonResponse({"csrfToken": get_token(request)})


@require_POST
def sign_in(request):
    if request.user.is_authenticated:
        return JsonResponse(_user_payload(request.user))

    data = _json_object(request)
    if data is None:
        return api_error("INVALID_JSON_OBJECT", 400, "The request body must be a JSON object.")

    username = data.get("username")
    password = data.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        return api_error(
            "INVALID_CREDENTIAL_FIELDS", 400, "Username and password must be strings."
        )
    username = username.strip()
    if not username or not password:
        return api_error(
            "CREDENTIALS_REQUIRED", 400, "Username and password are required."
        )

    user = authenticate(request, username=username, password=password)
    if user is None or not user.is_active:
        return api_error("INVALID_CREDENTIALS", 400, "Invalid username or password.")

    login(request, user)
    return JsonResponse(_user_payload(user))


@require_POST
def sign_out(request):
    logout(request)
    return JsonResponse({"ok": True})


def _user_payload(user):
    remaining = Coupon.objects.filter(user=user, redeemed_at__isnull=True).count()
    history = [
        {
            "id": str(spin_record.id),
            "prize": _spin_prize_payload(spin_record),
            "createdAt": spin_record.created_at.isoformat(),
        }
        for spin_record in Spin.objects.filter(user=user)[:8]
    ]
    return {
        "user": {
            "id": user.id,
            "username": user.get_username(),
            "displayName": user.get_full_name() or user.get_username(),
        },
        "remainingCoupons": remaining,
        "history": history,
    }


@require_GET
def me(request):
    if not request.user.is_authenticated:
        return _unauthorized()
    return JsonResponse(_user_payload(request.user))


@require_GET
def prizes(request):
    items = list(Prize.objects.order_by("slot"))
    if len(items) != 12 or [prize.slot for prize in items] != list(range(12)):
        return api_error(
            "CATALOG_INVALID",
            503,
            "The wheel catalog must contain exactly one prize in every slot from 0 through 11.",
        )
    return JsonResponse({"prizes": [_prize_payload(prize) for prize in items]})


def _create_or_replay_spin(user, request_id):
    try:
        with transaction.atomic():
            existing = Spin.objects.filter(user=user, request_id=request_id).first()
            if existing:
                return existing, True

            coupon = (
                Coupon.objects.select_for_update()
                .select_related("prize")
                .filter(user=user, redeemed_at__isnull=True)
                .order_by("created_at", "id")
                .first()
            )
            if coupon is None:
                existing = Spin.objects.filter(user=user, request_id=request_id).first()
                if existing:
                    return existing, True
                return None, False

            coupon.redeemed_at = timezone.now()
            coupon.save(update_fields=["redeemed_at"])
            spin_record = Spin.objects.create(
                user=user,
                coupon=coupon,
                prize=coupon.prize,
                request_id=request_id,
            )
            return spin_record, False
    except IntegrityError:
        # A concurrent request may have committed the same logical attempt first.
        existing = Spin.objects.filter(user=user, request_id=request_id).first()
        if existing:
            return existing, True
        raise


@require_POST
def spin(request):
    if not request.user.is_authenticated:
        return _unauthorized()

    request_id = _parse_request_id(request.headers.get("Idempotency-Key"))
    if request_id is None:
        return api_error(
            "INVALID_IDEMPOTENCY_KEY",
            400,
            "Idempotency-Key must be a valid UUID.",
        )

    spin_record, replayed = _create_or_replay_spin(request.user, request_id)
    if spin_record is None:
        return api_error("NO_COUPONS", 409, "No unused coupons remain.")

    payload = _spin_payload(spin_record)
    payload["replayed"] = replayed
    return JsonResponse(payload)


@require_GET
def recover_spin(request, request_id):
    if not request.user.is_authenticated:
        return _unauthorized()

    parsed_request_id = _parse_request_id(request_id)
    if parsed_request_id is None:
        return api_error(
            "INVALID_IDEMPOTENCY_KEY", 400, "The request identifier must be a valid UUID."
        )

    spin_record = Spin.objects.filter(
        user=request.user, request_id=parsed_request_id
    ).first()
    if spin_record is None:
        return api_error("SPIN_NOT_FOUND", 404, "No spin exists for this request identifier.")
    payload = _spin_payload(spin_record)
    payload["replayed"] = True
    return JsonResponse(payload)
