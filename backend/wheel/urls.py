from django.urls import path

from . import views


app_name = "wheel"

urlpatterns = [
    path("auth/csrf/", views.csrf, name="csrf"),
    path("auth/login/", views.sign_in, name="login"),
    path("auth/logout/", views.sign_out, name="logout"),
    path("auth/me/", views.me, name="me"),
    path("prizes/", views.prizes, name="prizes"),
    path("spin/", views.spin, name="spin"),
    path("spin/<str:request_id>/", views.recover_spin, name="recover-spin"),
]
