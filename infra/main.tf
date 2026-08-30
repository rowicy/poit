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

resource "cloudflare_zero_trust_access_service_token" "cli" {
  account_id = var.cloudflare_account_id
  name       = "ageage-cli"
}

resource "cloudflare_zero_trust_access_policy" "members_allow" {
  account_id = var.cloudflare_account_id
  name       = "allow-rowicy-members"
  decision   = "allow"
  include    = [for email in var.allowed_emails : { email = { email = email } }]
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

# Cloudflare Access path matching is prefix-based, so this "/" application
# protects the entire domain by default (every path starts with "/").
resource "cloudflare_zero_trust_access_application" "shell" {
  account_id       = var.cloudflare_account_id
  name             = "ageage-shell"
  type             = "self_hosted"
  session_duration = "24h"

  destinations = [
    { uri = "ageage.rowicy.com/" },
  ]

  policies = [
    { id = cloudflare_zero_trust_access_policy.members_allow.id, precedence = 1 },
  ]
}

# A more specific prefix overrides the root app above, so this reopens
# /artifact/* (the artifact viewer page and its raw-content endpoint) to
# external users with no login. Privacy for private artifacts is still
# enforced by the Worker itself via the CF_Authorization cookie.
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

# Exact-path application for the CLI's upload endpoint. This path is
# POST-only in the API, so scoping Access to it doesn't affect the public
# GET routes above. Lets the CLI authenticate with a Cloudflare Access
# Service Token instead of an interactive login.
resource "cloudflare_zero_trust_access_application" "cli_upload" {
  account_id                = var.cloudflare_account_id
  name                      = "ageage-cli-upload"
  type                      = "self_hosted"
  session_duration          = "24h"
  service_auth_401_redirect = true

  destinations = [
    { uri = "ageage.rowicy.com/api/v1/artifact" },
  ]

  policies = [
    { id = cloudflare_zero_trust_access_policy.members_or_cli_allow.id, precedence = 1 },
  ]
}
