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

resource "cloudflare_r2_bucket" "artifacts" {
  account_id = var.cloudflare_account_id
  name       = "ageage-artifacts"
  location   = "apac"
}

resource "cloudflare_workers_kv_namespace" "metadata" {
  account_id = var.cloudflare_account_id
  title      = "ageage-metadata"
}

resource "cloudflare_zero_trust_access_service_token" "cli" {
  account_id = var.cloudflare_account_id
  name       = "ageage-cli"
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
  name             = "ageage-shell"
  type             = "self_hosted"
  session_duration = "24h"

  destinations = [
    { uri = "ageage.rowicy.com/" },
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
  name             = "ageage-artifact-public"
  type             = "self_hosted"
  session_duration = "24h"

  destinations = [
    { uri = "ageage.rowicy.com/artifact" },
    { uri = "ageage.rowicy.com/assets" },
  ]

  policies = [
    { id = cloudflare_zero_trust_access_policy.bypass.id, precedence = 1 },
  ]
}
