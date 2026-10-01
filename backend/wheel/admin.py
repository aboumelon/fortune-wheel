import jdatetime
from django.contrib import admin
from django.utils import timezone
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _

from .models import Coupon, Prize, Spin


PERSIAN_DIGITS = str.maketrans(
    "0123456789", "".join(chr(0x06F0 + value) for value in range(10))
)


def format_jalali(value):
    """Format a stored timestamp in the Jalali calendar and Tehran time."""
    if value is None:
        return "—"
    local_value = timezone.localtime(value)
    jalali_value = jdatetime.datetime.fromgregorian(datetime=local_value)
    return jalali_value.strftime("%Y/%m/%d\u060c %H:%M").translate(PERSIAN_DIGITS)


class CouponStateFilter(admin.SimpleListFilter):
    title = _("Coupon status")
    parameter_name = "coupon_state"

    def lookups(self, request, model_admin):
        return (("available", _("Available")), ("redeemed", _("Redeemed")))

    def queryset(self, request, queryset):
        if self.value() == "available":
            return queryset.filter(redeemed_at__isnull=True)
        if self.value() == "redeemed":
            return queryset.filter(redeemed_at__isnull=False)
        return queryset


@admin.register(Prize)
class PrizeAdmin(admin.ModelAdmin):
    list_display = ("slot_number", "icon", "name", "color_preview", "is_active")
    list_editable = ("is_active",)
    ordering = ("slot",)
    search_fields = ("name", "description")

    @admin.display(description=_("Slot"), ordering="slot")
    def slot_number(self, obj):
        return obj.slot + 1

    @admin.display(description=_("Color"))
    def color_preview(self, obj):
        return format_html(
            '<span class="color-preview" style="--prize-color:{}"></span><bdi>{}</bdi>',
            obj.color,
            obj.color,
        )

    def get_readonly_fields(self, request, obj=None):
        return ("slot",) if obj else ()

    def has_add_permission(self, request):
        return Prize.objects.count() < 12

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Coupon)
class CouponAdmin(admin.ModelAdmin):
    list_display = (
        "short_code",
        "user",
        "prize",
        "status",
        "created_at_local",
        "redeemed_at_local",
    )
    list_filter = (CouponStateFilter, "prize")
    search_fields = ("user__username", "user__email", "code")
    autocomplete_fields = ("user", "prize")
    fields = ("user", "prize", "code", "created_at_local", "redeemed_at_local")

    def get_readonly_fields(self, request, obj=None):
        base_fields = ("code", "created_at_local", "redeemed_at_local")
        if obj and obj.is_redeemed:
            return ("user", "prize", *base_fields)
        return base_fields

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "prize":
            kwargs["queryset"] = Prize.objects.filter(is_active=True).order_by("slot")
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    @admin.display(description=_("Code"))
    def short_code(self, obj):
        return str(obj.code).split("-")[0]

    @admin.display(description=_("Available"), boolean=True)
    def status(self, obj):
        return not obj.is_redeemed

    @admin.display(description=_("Created (Jalali)"), ordering="created_at")
    def created_at_local(self, obj):
        return format_jalali(obj.created_at)

    @admin.display(description=_("Redeemed (Jalali)"), ordering="redeemed_at")
    def redeemed_at_local(self, obj):
        return format_jalali(obj.redeemed_at)


@admin.register(Spin)
class SpinAdmin(admin.ModelAdmin):
    list_display = ("short_id", "user", "prize_name", "created_at_local")
    list_filter = ("prize",)
    search_fields = ("user__username", "coupon__code", "request_id")
    readonly_fields = (
        "id",
        "request_id",
        "user",
        "coupon",
        "prize",
        "prize_slot",
        "prize_name",
        "prize_description",
        "prize_icon",
        "prize_color",
        "created_at_local",
    )
    fields = readonly_fields

    @admin.display(description=_("Identifier"), ordering="id")
    def short_id(self, obj):
        return str(obj.id).split("-")[0]

    @admin.display(description=_("Spun at (Jalali)"), ordering="created_at")
    def created_at_local(self, obj):
        return format_jalali(obj.created_at)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.site_header = _("Fortune Wheel administration")
admin.site.site_title = _("Administration panel")
admin.site.index_title = _("Administration dashboard")
admin.site.site_url = "/"
admin.site.enable_nav_sidebar = False
