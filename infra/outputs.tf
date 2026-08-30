output "access_application_auds" {
  description = "Set this as the ageage Worker's CF_ACCESS_AUD secret"
  value       = cloudflare_zero_trust_access_application.shell.aud
}

output "metadata_kv_namespace_id" {
  value = cloudflare_workers_kv_namespace.metadata.id
}

output "cli_service_token_client_id" {
  value = cloudflare_zero_trust_access_service_token.cli.client_id
}

output "cli_service_token_client_secret" {
  value     = cloudflare_zero_trust_access_service_token.cli.client_secret
  sensitive = true
}
