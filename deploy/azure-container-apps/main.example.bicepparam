// Example parameters. Copy to your private deployment repo and replace every
// <placeholder>. Contains no secrets: the PostgreSQL admin password and all
// app secrets are read from Key Vault.
using 'main.bicep'

param env = 'staging'
param namePrefix = 'quizme'
param keyVaultName = '<your-keyvault-name>'
param postgresServerName = '<your-postgres-server-name>'
param registryName = ''
param webImage = 'ghcr.io/limequizz/quizme-web:<git-sha>'
param extractorImage = 'ghcr.io/limequizz/quizme-extractor:<git-sha>'
param publicUrl = 'https://<your-domain>'
param alertEmails = []
