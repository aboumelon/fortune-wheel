import json
import threading
import uuid
from datetime import datetime, timezone as dt_timezone
from unittest import skipUnless
from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import close_old_connections, connection
from django.test import Client, SimpleTestCase, TestCase, TransactionTestCase
from django.urls import reverse
from django.utils import timezone

from .admin import CouponAdmin, SpinAdmin, format_jalali
from .models import Coupon, Prize, Spin
from .views import _create_or_replay_spin


class JalaliDateTests(SimpleTestCase):
    def test_datetime_is_formatted_in_jalali_with_persian_digits(self):
        value = datetime(2026, 9, 30, 7, 0, tzinfo=dt_timezone.utc)
        self.assertEqual(
            format_jalali(value),
            "\u06f1\u06f4\u06f0\u06f5/\u06f0\u06f7/\u06f0\u06f8\u060c \u06f1\u06f0:\u06f3\u06f0",
        )


class AuthenticatedApiTestCase(TestCase):
    username = "sara"
    password = "safe-pass-123"

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            self.username, password=self.password
        )
        self.client = Client(enforce_csrf_checks=True)
        self.client.get(reverse("wheel:csrf"))
        token = self.client.cookies["csrftoken"].value
        response = self.client.post(
            reverse("wheel:login"),
            json.dumps({"username": self.username, "password": self.password}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(response.status_code, 200)
        self.csrf = self.client.cookies["csrftoken"].value

    def post_spin(self, request_id=None):
        return self.client.post(
            reverse("wheel:spin"),
            HTTP_X_CSRFTOKEN=self.csrf,
            HTTP_IDEMPOTENCY_KEY=str(request_id or uuid.uuid4()),
        )


class LoginValidationTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.client.get(reverse("wheel:csrf"))
        self.csrf = self.client.cookies["csrftoken"].value

    def post_raw(self, body):
        return self.client.generic(
            "POST",
            reverse("wheel:login"),
            body,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.csrf,
        )

    def test_non_object_and_malformed_login_bodies_return_json_400(self):
        bodies = [b"[]", b'"value"', b"12", b"null", b"{", b"\xff"]
        for body in bodies:
            with self.subTest(body=body):
                response = self.post_raw(body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["code"], "INVALID_JSON_OBJECT")

    def test_non_string_credential_fields_return_json_400(self):
        response = self.post_raw(b'{"username": [], "password": 10}')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "INVALID_CREDENTIAL_FIELDS")

    def test_vite_local_origins_can_log_in_and_redeem_a_coupon(self):
        get_user_model().objects.create_user("local-user", password="safe-pass-123")
        for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
            with self.subTest(origin=origin):
                client = Client(enforce_csrf_checks=True)
                client.get(reverse("wheel:csrf"))
                response = client.post(
                    reverse("wheel:login"),
                    json.dumps({"username": "local-user", "password": "safe-pass-123"}),
                    content_type="application/json",
                    HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
                    HTTP_ORIGIN=origin,
                    HTTP_HOST="localhost:8000",
                )
                self.assertEqual(response.status_code, 200)
                Coupon.objects.create(
                    user=get_user_model().objects.get(username="local-user"),
                    prize=Prize.objects.get(slot=4),
                )
                spin_response = client.post(
                    reverse("wheel:spin"),
                    HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
                    HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
                    HTTP_ORIGIN=origin,
                    HTTP_HOST="localhost:8000",
                )
                self.assertEqual(spin_response.status_code, 200)

    def test_untrusted_origin_still_fails_csrf_validation(self):
        response = self.client.post(
            reverse("wheel:login"),
            json.dumps({"username": "local-user", "password": "safe-pass-123"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.csrf,
            HTTP_ORIGIN="https://untrusted.example",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "CSRF_FAILED")


class SpinApiTests(AuthenticatedApiTestCase):
    def test_spin_returns_preassigned_prize_and_consumes_coupon(self):
        prize = Prize.objects.get(slot=9)
        coupon = Coupon.objects.create(user=self.user, prize=prize)

        response = self.post_spin()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["prize"]["slot"], 9)
        self.assertEqual(response.json()["remainingCoupons"], 0)
        coupon.refresh_from_db()
        self.assertIsNotNone(coupon.redeemed_at)
        self.assertTrue(Spin.objects.filter(coupon=coupon, prize=prize).exists())

    def test_sequential_replay_returns_one_spin_and_consumes_one_coupon(self):
        Coupon.objects.create(user=self.user, prize=Prize.objects.get(slot=9))
        Coupon.objects.create(user=self.user, prize=Prize.objects.get(slot=2))
        request_id = uuid.uuid4()

        first = self.post_spin(request_id)
        second = self.post_spin(request_id)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["spinId"], second.json()["spinId"])
        self.assertFalse(first.json()["replayed"])
        self.assertTrue(second.json()["replayed"])
        self.assertEqual(Spin.objects.count(), 1)
        self.assertEqual(Coupon.objects.filter(redeemed_at__isnull=True).count(), 1)

    def test_separate_request_identifiers_consume_distinct_coupons(self):
        Coupon.objects.create(user=self.user, prize=Prize.objects.get(slot=9))
        Coupon.objects.create(user=self.user, prize=Prize.objects.get(slot=2))

        first = self.post_spin(uuid.uuid4())
        second = self.post_spin(uuid.uuid4())

        self.assertNotEqual(first.json()["spinId"], second.json()["spinId"])
        self.assertEqual(Spin.objects.count(), 2)
        self.assertEqual(Coupon.objects.filter(redeemed_at__isnull=True).count(), 0)

    def test_replay_succeeds_after_last_coupon_is_consumed(self):
        Coupon.objects.create(user=self.user, prize=Prize.objects.get(slot=3))
        request_id = uuid.uuid4()
        self.assertEqual(self.post_spin(request_id).status_code, 200)

        replay = self.post_spin(request_id)

        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["remainingCoupons"], 0)

    def test_issued_coupon_is_honored_after_prize_deactivation(self):
        prize = Prize.objects.get(slot=4)
        Coupon.objects.create(user=self.user, prize=prize)
        prize.is_active = False
        prize.save(update_fields=["is_active"])

        response = self.post_spin()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["prize"]["slot"], 4)

    def test_public_catalog_keeps_all_slots_when_prize_is_inactive(self):
        prize = Prize.objects.get(slot=4)
        prize.is_active = False
        prize.save(update_fields=["is_active"])

        response = self.client.get(reverse("wheel:prizes"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["slot"] for item in response.json()["prizes"]], list(range(12)))

    def test_invalid_catalog_returns_specific_configuration_error(self):
        Prize.objects.get(slot=0).delete()

        response = self.client.get(reverse("wheel:prizes"))

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "CATALOG_INVALID")

    def test_recovery_is_scoped_to_authenticated_owner(self):
        Coupon.objects.create(user=self.user, prize=Prize.objects.get(slot=1))
        request_id = uuid.uuid4()
        created = self.post_spin(request_id)
        other = get_user_model().objects.create_user("other", password="other-pass-123")
        other_client = Client()
        other_client.force_login(other)

        response = other_client.get(
            reverse("wheel:recover-spin", kwargs={"request_id": request_id})
        )

        self.assertEqual(created.status_code, 200)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "SPIN_NOT_FOUND")

    def test_spin_requires_valid_identifier_authentication_and_csrf(self):
        Coupon.objects.create(user=self.user, prize=Prize.objects.get(slot=1))
        missing_key = self.client.post(
            reverse("wheel:spin"), HTTP_X_CSRFTOKEN=self.csrf
        )
        invalid_key = self.client.post(
            reverse("wheel:spin"),
            HTTP_X_CSRFTOKEN=self.csrf,
            HTTP_IDEMPOTENCY_KEY="not-a-uuid",
        )
        no_csrf_client = Client(enforce_csrf_checks=True)
        no_csrf_client.force_login(self.user)
        no_csrf = no_csrf_client.post(
            reverse("wheel:spin"), HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4())
        )
        anonymous = Client().post(
            reverse("wheel:spin"), HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4())
        )

        self.assertEqual(missing_key.json()["code"], "INVALID_IDEMPOTENCY_KEY")
        self.assertEqual(invalid_key.json()["code"], "INVALID_IDEMPOTENCY_KEY")
        self.assertEqual(no_csrf.status_code, 403)
        self.assertEqual(no_csrf.json()["code"], "CSRF_FAILED")
        self.assertEqual(anonymous.status_code, 401)

    def test_spin_creation_failure_rolls_back_coupon_redemption(self):
        coupon = Coupon.objects.create(user=self.user, prize=Prize.objects.get(slot=7))

        with patch("wheel.views.Spin.objects.create", side_effect=RuntimeError("injected")):
            with self.assertRaises(RuntimeError):
                _create_or_replay_spin(self.user, uuid.uuid4())

        coupon.refresh_from_db()
        self.assertIsNone(coupon.redeemed_at)
        self.assertFalse(Spin.objects.exists())


class AuditProtectionTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("audit-user")
        self.other_user = get_user_model().objects.create_user("audit-other")
        self.prize = Prize.objects.get(slot=9)
        self.other_prize = Prize.objects.get(slot=10)
        self.coupon = Coupon.objects.create(user=self.user, prize=self.prize)
        self.coupon.redeemed_at = timezone.now()
        self.coupon.save(update_fields=["redeemed_at"])
        self.spin = Spin.objects.create(
            user=self.user,
            coupon=self.coupon,
            prize=self.prize,
            request_id=uuid.uuid4(),
        )

    def test_redeemed_coupon_owner_prize_and_state_are_immutable(self):
        self.coupon.user = self.other_user
        self.coupon.prize = self.other_prize
        self.coupon.redeemed_at = None

        with self.assertRaises(ValidationError):
            self.coupon.save()

    def test_redeemed_coupon_fields_are_read_only_in_admin(self):
        model_admin = CouponAdmin(Coupon, admin.site)
        fields = model_admin.get_readonly_fields(None, self.coupon)
        self.assertIn("user", fields)
        self.assertIn("prize", fields)
        self.assertIn("redeemed_at_local", fields)

    def test_spin_cannot_be_deleted_through_admin(self):
        model_admin = SpinAdmin(Spin, admin.site)
        self.assertFalse(model_admin.has_delete_permission(None, self.spin))

    def test_prize_snapshot_preserves_historical_result(self):
        original_name = self.spin.prize_name
        self.prize.name = "Updated technical name"
        self.prize.save(update_fields=["name"])
        self.spin.refresh_from_db()
        self.assertEqual(self.spin.prize_name, original_name)


@skipUnless(connection.vendor == "postgresql", "PostgreSQL is required for row-lock tests")
class PostgreSQLConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.user = get_user_model().objects.create_user("parallel", password="safe-pass-123")
        prize_nine, _ = Prize.objects.get_or_create(
            slot=9,
            defaults={"name": "Concurrency prize 9", "color": "#8B5CF6"},
        )
        prize_two, _ = Prize.objects.get_or_create(
            slot=2,
            defaults={"name": "Concurrency prize 2", "color": "#F97316"},
        )
        Coupon.objects.create(user=self.user, prize=prize_nine)
        Coupon.objects.create(user=self.user, prize=prize_two)

    def run_parallel(self, request_ids):
        barrier = threading.Barrier(len(request_ids))
        results = [None] * len(request_ids)

        def worker(index, request_id):
            close_old_connections()
            try:
                client = Client()
                client.force_login(get_user_model().objects.get(pk=self.user.pk))
                barrier.wait()
                response = client.post(
                    reverse("wheel:spin"), HTTP_IDEMPOTENCY_KEY=str(request_id)
                )
                results[index] = (response.status_code, response.json())
            finally:
                connection.close()

        threads = [
            threading.Thread(target=worker, args=(index, request_id))
            for index, request_id in enumerate(request_ids)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertTrue(all(not thread.is_alive() for thread in threads))
        return results

    def test_concurrent_replay_consumes_only_one_coupon(self):
        request_id = uuid.uuid4()

        results = self.run_parallel([request_id, request_id])

        self.assertEqual([status for status, _ in results], [200, 200])
        self.assertEqual(results[0][1]["spinId"], results[1][1]["spinId"])
        self.assertEqual(Spin.objects.count(), 1)
        self.assertEqual(Coupon.objects.filter(redeemed_at__isnull=False).count(), 1)

    def test_concurrent_distinct_attempts_consume_distinct_coupons(self):
        results = self.run_parallel([uuid.uuid4(), uuid.uuid4()])

        self.assertEqual([status for status, _ in results], [200, 200])
        self.assertNotEqual(results[0][1]["spinId"], results[1][1]["spinId"])
        self.assertEqual(Spin.objects.count(), 2)
        self.assertEqual(Coupon.objects.filter(redeemed_at__isnull=False).count(), 2)
