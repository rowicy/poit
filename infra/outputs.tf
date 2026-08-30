output "cli_service_token_client_id" {
  value = cloudflare_zero_trust_access_service_token.cli.client_id
}

output "cli_service_token_client_secret" {
  value     = cloudflare_zero_trust_access_service_token.cli.client_secret
  sensitive = true
}
