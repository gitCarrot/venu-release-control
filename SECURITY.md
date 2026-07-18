# Security policy

Do not report credentials in a public issue. This repository must never hold
application source, environment files, service-account JSON, signing keys,
passwords, access tokens, or production release artifacts.

Production-impacting changes require a new, exact workflow commit and a
separate Google Cloud trust update. Changing a branch or tag must never change
which workflow bytes can obtain production credentials.
