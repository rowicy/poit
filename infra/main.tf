terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

locals {
  hostname = "poit.rowicy.com"
}

resource "cloudflare_r2_bucket" "artifacts" {
  account_id = var.cloudflare_account_id
  name       = "poit-artifacts"
  location   = "apac"
}

resource "cloudflare_workers_kv_namespace" "metadata" {
  account_id = var.cloudflare_account_id
  title      = "poit-metadata"
}

# Non-persisted artifact bodies live under the "ephemeral/" prefix (see
# store.ts) and are deleted here after 90 days, matching the KV metadata's
# expirationTtl and store.ts's DEFAULT_TTL_SECONDS - no cron/list-scan
# needed for either store.
resource "cloudflare_r2_bucket_lifecycle" "artifacts" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.artifacts.name

  rules = [{
    id         = "expire-ephemeral"
    enabled    = true
    conditions = { prefix = "ephemeral/" }
    delete_objects_transition = {
      condition = { type = "Age", max_age = 90 * 24 * 60 * 60 }
    }
  }]
}

resource "cloudflare_zero_trust_access_service_token" "cli" {
  account_id = var.cloudflare_account_id
  name       = "poit-cli"
}

resource "cloudflare_zero_trust_access_policy" "members_or_cli_allow" {
  account_id = var.cloudflare_account_id
  name       = "allow-rowicy-members-or-cli"
  decision   = "allow"

  include = concat(
    [for email in var.allowed_emails : { email = { email = email } }],
    [{ service_token = { token_id = cloudflare_zero_trust_access_service_token.cli.id } }],
  )
}

resource "cloudflare_zero_trust_access_policy" "bypass" {
  account_id = var.cloudflare_account_id
  name       = "bypass"
  decision   = "bypass"
  include    = [{ everyone = {} }]
}

# Cloudflare Access path matching is prefix-based, so this single "/"
# application protects the entire domain by default (every path starts with
# "/") - the SPA shell, GET /api/v1/artifacts, and the artifact mutation
# endpoints all fall under it. Keeping this as ONE application (one aud) is
# important: a browser session authenticated against this app satisfies
# every path under it with no further redirect. Splitting mutation endpoints
# into a second Access Application (a separate aud) previously broke the
# SPA's own fetch() calls - Access would silently redirect a same-origin XHR
# through a cross-origin login page, which the browser reports as a plain
# network failure ("Load failed") rather than a readable 401/403.
resource "cloudflare_zero_trust_access_application" "shell" {
  account_id       = var.cloudflare_account_id
  name             = "poit-shell"
  type             = "self_hosted"
  session_duration = "24h"

  destinations = [
    { uri = "${local.hostname}/" },
  ]

  policies = [
    { id = cloudflare_zero_trust_access_policy.members_or_cli_allow.id, precedence = 1 },
  ]
}

# A more specific prefix overrides the root app above, so this reopens
# /artifact/* (the artifact viewer page and its raw-content endpoint) and
# /assets/* (its JS/CSS) to external users with no login. Privacy for
# private artifacts is still enforced by the Worker itself via the
# CF_Authorization cookie.
resource "cloudflare_zero_trust_access_application" "artifact_public" {
  account_id       = var.cloudflare_account_id
  name             = "poit-artifact-public"
  type             = "self_hosted"
  session_duration = "24h"

  destinations = [
    { uri = "${local.hostname}/artifact" },
    { uri = "${local.hostname}/assets" },
  ]

  policies = [
    { id = cloudflare_zero_trust_access_policy.bypass.id, precedence = 1 },
  ]
}

# The Worker script itself: deployed by Terraform (not `wrangler deploy`) so
# the whole stack - bindings, static assets, routing, schedule - lives in one
# place. Run `pnpm --filter poit-app build` first to produce dist/index.js
# (esbuild-bundled from src/index.ts); `terraform apply` picks up content
# changes via content_sha256.
resource "cloudflare_workers_script" "app" {
  account_id  = var.cloudflare_account_id
  script_name = "poit"

  main_module     = "index.js"
  content_file    = "${path.module}/../apps/app/dist/index.js"
  content_sha256  = filesha256("${path.module}/../apps/app/dist/index.js")
  compatibility_date  = "2026-08-01"
  compatibility_flags = ["nodejs_compat"]

  assets = {
    directory = "${path.module}/../apps/app/public"
    config = {
      not_found_handling = "single-page-application"
      # Unlike wrangler, this provider does not auto-detect a physical
      # public/_headers file - its contents must be passed explicitly here.
      headers = file("${path.module}/../apps/app/public/_headers")
    }
  }

  bindings = [
    { name = "ASSETS", type = "assets" },
    { name = "ARTIFACTS", type = "r2_bucket", bucket_name = cloudflare_r2_bucket.artifacts.name },
    { name = "METADATA", type = "kv_namespace", namespace_id = cloudflare_workers_kv_namespace.metadata.id },
    { name = "CF_ACCESS_TEAM_DOMAIN", type = "plain_text", text = "rowicy" },
    { name = "CF_ACCESS_AUD", type = "secret_text", text = cloudflare_zero_trust_access_application.shell.aud },
  ]
}

resource "cloudflare_workers_cron_trigger" "app" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_workers_script.app.script_name
  schedules   = [{ cron = "0 3 * * *" }]
}

resource "cloudflare_workers_custom_domain" "app" {
  account_id = var.cloudflare_account_id
  zone_id    = var.cloudflare_zone_id
  hostname   = local.hostname
  service    = cloudflare_workers_script.app.script_name
}
