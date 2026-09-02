FROM evoapicloud/evolution-api:v2.3.7

COPY patch-profile-reload.mjs /tmp/patch-profile-reload.mjs
RUN node /tmp/patch-profile-reload.mjs && rm /tmp/patch-profile-reload.mjs

