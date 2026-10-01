import json
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from wheel.models import Coupon, Prize


CONTENT_FILE = Path(__file__).resolve().parents[2] / "localized_content" / "fa.json"


class Command(BaseCommand):
    help = "Create or refresh explicit local-evaluation users, prizes, and demo coupons."

    def handle(self, *args, **options):
        if not CONTENT_FILE.exists():
            raise CommandError(f"Localized demo content is missing: {CONTENT_FILE}")

        content = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
        prizes = content.get("prizes")
        if not isinstance(prizes, list) or [item.get("slot") for item in prizes] != list(
            range(12)
        ):
            raise CommandError("Localized demo content must define slots 0 through 11 in order.")

        with transaction.atomic():
            for item in prizes:
                Prize.objects.update_or_create(
                    slot=item["slot"],
                    defaults={
                        "name": item["name"],
                        "description": item["description"],
                        "icon": item["icon"],
                        "color": item["color"],
                    },
                )

            User = get_user_model()
            admin, created = User.objects.get_or_create(
                username="admin",
                defaults={
                    "email": "admin@example.com",
                    "is_staff": True,
                    "is_superuser": True,
                },
            )
            if created:
                admin.set_password("admin12345")
                admin.save()

            demo, created = User.objects.get_or_create(
                username="demo",
                defaults={"first_name": content["demoDisplayName"]},
            )
            if created:
                demo.set_password("demo12345")
                demo.save()

            if not demo.coupons.exists():
                for slot in (9, 2, 11, 5, 7):
                    Coupon.objects.create(user=demo, prize=Prize.objects.get(slot=slot))

        self.stdout.write(
            self.style.SUCCESS("Demo ready: demo/demo12345 and admin/admin12345")
        )
