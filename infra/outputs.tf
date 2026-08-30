output "access_application_auds" {
  description = "Comma-separated list to set as the ageage Worker's CF_ACCESS_AUD secret"
  value = join(",", [
    cloudflare_zero_trust_access_application.shell.aud,
    cloudflare_zero_trust_access_application.cli_upload.aud,
  ])
}

output "cli_service_token_client_id" {
  value = cloudflare_zero_trust_access_service_token.cli.client_id
}

output "cli_service_token_client_secret" {
  value     = cloudflare_zero_trust_access_service_token.cli.client_secret
  sensitive = true
}
