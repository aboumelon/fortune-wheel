import json
import uuid
from pathlib import Path

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def seed_prizes(apps, schema_editor):
    Prize = apps.get_model("wheel", "Prize")
    # Keep initial seed content frozen independently of editable demo content.
    data_path = Path(__file__).parent / "data" / "0001_prizes_fa.json"
    defaults = json.loads(data_path.read_text(encoding="utf-8"))
    for prize in defaults:
        Prize.objects.using(schema_editor.connection.alias).create(**prize)


class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="Prize",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slot", models.PositiveSmallIntegerField(help_text="A number from 0 through 11; slot 0 is at the top.", unique=True, validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(11)], verbose_name="Wheel slot")),
                ("name", models.CharField(max_length=80, verbose_name="Prize name")),
                ("description", models.CharField(blank=True, max_length=180, verbose_name="Short description")),
                ("icon", models.CharField(default="🎁", max_length=8, verbose_name="Icon")),
                ("color", models.CharField(default="#7C3AED", max_length=7, verbose_name="Color")),
                ("is_active", models.BooleanField(default=True, verbose_name="Available for new coupons")),
            ],
            options={"verbose_name": "Prize", "verbose_name_plural": "Prizes", "ordering": ["slot"]},
        ),
        migrations.CreateModel(
            name="Coupon",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.UUIDField(default=uuid.uuid4, editable=False, unique=True, verbose_name="Code")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created at")),
                ("redeemed_at", models.DateTimeField(blank=True, null=True, verbose_name="Redeemed at")),
                ("prize", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="coupons", to="wheel.prize", verbose_name="Preassigned prize")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="coupons", to=settings.AUTH_USER_MODEL, verbose_name="User")),
            ],
            options={"verbose_name": "Coupon", "verbose_name_plural": "Coupons", "ordering": ["created_at", "id"]},
        ),
        migrations.CreateModel(
            name="Spin",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Spun at")),
                ("coupon", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="spin", to="wheel.coupon", verbose_name="Coupon")),
                ("prize", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="spins", to="wheel.prize", verbose_name="Prize")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="spins", to=settings.AUTH_USER_MODEL, verbose_name="User")),
            ],
            options={"verbose_name": "Spin", "verbose_name_plural": "Spin history", "ordering": ["-created_at"]},
        ),
        migrations.AddIndex(
            model_name="coupon",
            index=models.Index(fields=["user", "redeemed_at", "created_at"], name="wheel_coupo_user_id_8df0ea_idx"),
        ),
        migrations.RunPython(seed_prizes, migrations.RunPython.noop),
    ]

