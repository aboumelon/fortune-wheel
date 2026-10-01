from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class WheelConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "wheel"
    verbose_name = _("Fortune Wheel")
