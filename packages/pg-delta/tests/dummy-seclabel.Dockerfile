# Custom test image: postgres:<version>-alpine + the `dummy_seclabel` test
# contrib module. That module registers the "dummy" SECURITY LABEL provider,
# which stores labels VERBATIM and accepts any string — exactly what an
# end-to-end roundtrip proof needs (a real provider such as pgsodium validates
# and normalizes labels against its own grammar, so the apply→re-extract→compare
# proof would couple to that grammar). It also needs no SELinux. Used only by
# tests/security-label-proof.test.ts via tests/containers.ts::seclabelCluster.
#
# Build args:
#   PG_MAJOR    — PostgreSQL major version (15 / 17 / 18)
#   PG_BRANCH   — matching PostgreSQL git branch (e.g. REL_17_STABLE)
#   ALPINE_TAG  — Alpine base tag that ships postgresql<PG_MAJOR>-dev
#                 (pg15 → 3.19; pg17/18 → 3.23)

# Global build args (re-declared inside each stage that uses them)
ARG PG_MAJOR=17
ARG PG_BRANCH=REL_17_STABLE
ARG ALPINE_TAG=3.23

# ---- Build stage: compile dummy_seclabel.so against the matching PG dev headers
FROM alpine:${ALPINE_TAG} AS builder

ARG PG_MAJOR
ARG PG_BRANCH

RUN set -eux; \
    apk update; \
    apk add --no-cache \
        alpine-sdk \
        postgresql${PG_MAJOR} \
        postgresql${PG_MAJOR}-dev \
        curl; \
    mkdir -p /tmp/dummy_seclabel; \
    cd /tmp/dummy_seclabel; \
    base="https://raw.githubusercontent.com/postgres/postgres/${PG_BRANCH}/src/test/modules/dummy_seclabel"; \
    for f in dummy_seclabel.c dummy_seclabel--1.0.sql dummy_seclabel.control Makefile; do \
        curl -fsSL "${base}/${f}" -o "${f}"; \
    done; \
    make PG_CONFIG=/usr/libexec/postgresql${PG_MAJOR}/pg_config USE_PGXS=1 with_llvm=no

# ---- Runtime stage: copy the compiled artifacts into the official PG image
FROM postgres:${PG_MAJOR}-alpine

COPY --from=builder /tmp/dummy_seclabel/dummy_seclabel.so \
    /usr/local/lib/postgresql/dummy_seclabel.so
COPY --from=builder /tmp/dummy_seclabel/dummy_seclabel--1.0.sql \
    /usr/local/share/postgresql/extension/dummy_seclabel--1.0.sql
COPY --from=builder /tmp/dummy_seclabel/dummy_seclabel.control \
    /usr/local/share/postgresql/extension/dummy_seclabel.control
