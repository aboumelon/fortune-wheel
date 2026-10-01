import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _


class Prize(models.Model):
    slot = models.PositiveSmallIntegerField(
        _("Wheel slot"),
        unique=True,
        validators=[MinValueValidator(0), MaxValueValidator(11)],
        help_text=_("A number from 0 through 11; slot 0 is at the top."),
    )
    name = models.CharField(_("Prize name"), max_length=80)
    description = models.CharField(_("Short description"), max_length=180, blank=True)
    icon = models.CharField(_("Icon"), max_length=8, default="🎁")
    color = models.CharField(_("Color"), max_length=7, default="#7C3AED")
    is_active = models.BooleanField(
        _("Available for new coupons"),
        default=True,
        help_text=_(
            "Inactive prizes remain on the wheel and are still honored for issued coupons."
        ),
    )

    class Meta:
        ordering = ["slot"]
        verbose_name = _("Prize")
        verbose_name_plural = _("Prizes")

    def __str__(self):
        return f"{self.slot + 1}. {self.name}"


class Coupon(models.Model):
    code = models.UUIDField(_("Code"), default=uuid.uuid4, unique=True, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("User"),
        related_name="coupons",
        on_delete=models.CASCADE,
    )
    prize = models.ForeignKey(
        Prize,
        verbose_name=_("Preassigned prize"),
        related_name="coupons",
        on_delete=models.PROTECT,
    )
    created_at = models.DateTimeField(_("Created at"), auto_now_add=True)
    redeemed_at = models.DateTimeField(_("Redeemed at"), null=True, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = _("Coupon")
        verbose_name_plural = _("Coupons")
        indexes = [
            models.Index(
                fields=["user", "redeemed_at", "created_at"],
                name="wheel_coupo_user_id_8df0ea_idx",
            ),
        ]

    @property
    def is_redeemed(self):
        return self.redeemed_at is not None

    def clean(self):
        super().clean()
        original = Coupon.objects.filter(pk=self.pk).first() if self.pk else None
        if original and original.is_redeemed:
            immutable_changed = (
                self.user_id != original.user_id
                or self.prize_id != original.prize_id
                or self.redeemed_at != original.redeemed_at
            )
            if immutable_changed:
                raise ValidationError(
                    _("The owner, prize, and redemption state of a redeemed coupon are immutable.")
                )

        prize_changed = original is None or self.prize_id != original.prize_id
        if prize_changed and self.prize_id and not self.prize.is_active:
            raise ValidationError(
                {"prize": _("Only active prizes can be assigned to new coupons.")}
            )

    def save(self, *args, **kwargs):
        if self.pk:
            original = Coupon.objects.filter(pk=self.pk).first()
            if original and original.is_redeemed:
                immutable_changed = (
                    self.user_id != original.user_id
                    or self.prize_id != original.prize_id
                    or self.redeemed_at != original.redeemed_at
                )
                if immutable_changed:
                    raise ValidationError(
                        _(
                            "The owner, prize, and redemption state of a redeemed coupon are immutable."
                        )
                    )
        return super().save(*args, **kwargs)

    def __str__(self):
        state = _("Redeemed") if self.is_redeemed else _("Available")
        return f"{self.user} — {self.prize.name} ({state})"


class Spin(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request_id = models.UUIDField(_("Request identifier"), default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("User"),
        related_name="spins",
        on_delete=models.CASCADE,
    )
    coupon = models.OneToOneField(
        Coupon,
        verbose_name=_("Coupon"),
        related_name="spin",
        on_delete=models.PROTECT,
    )
    prize = models.ForeignKey(
        Prize,
        verbose_name=_("Prize"),
        related_name="spins",
        on_delete=models.PROTECT,
    )
    prize_slot = models.PositiveSmallIntegerField(_("Prize slot"), default=0)
    prize_name = models.CharField(_("Prize name snapshot"), max_length=80, blank=True)
    prize_description = models.CharField(
        _("Prize description snapshot"), max_length=180, blank=True
    )
    prize_icon = models.CharField(_("Prize icon snapshot"), max_length=8, blank=True)
    prize_color = models.CharField(_("Prize color snapshot"), max_length=7, blank=True)
    created_at = models.DateTimeField(_("Spun at"), auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = _("Spin")
        verbose_name_plural = _("Spin history")
        constraints = [
            models.UniqueConstraint(
                fields=["user", "request_id"], name="unique_spin_request_per_user"
            )
        ]

    def save(self, *args, **kwargs):
        if self._state.adding:
            self.prize_slot = self.prize.slot
            self.prize_name = self.prize.name
            self.prize_description = self.prize.description
            self.prize_icon = self.prize.icon
            self.prize_color = self.prize.color
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.user} — {self.prize_name}"
