// Reference deployment of Quiz.me on Azure Container Apps.
//
// Every name is a parameter; nothing here refers to a real tenant,
// subscription, or domain. Copy this folder into your own private
// deployment repository and set values in a .bicepparam file there.
// See docs/deploy.md.
//
// First run with bootstrap=true (creates the network, Log Analytics, Key
// Vault and identities), seed the Key Vault secrets, then run again with
// bootstrap=false to create PostgreSQL and the apps.

targetScope = 'resourceGroup'

@description('Short environment name, e.g. staging, qa, prod.')
param env string
param location string = resourceGroup().location
@description('Prefix for resource names.')
param namePrefix string = 'quizme'
@description('Create only the foundation (network, logs, Key Vault, identities).')
param bootstrap bool = false

@description('Globally unique Key Vault name.')
param keyVaultName string
@description('Globally unique PostgreSQL server name.')
param postgresServerName string
@description('Globally unique container registry name. Empty pulls images straight from the public registry.')
param registryName string = ''

param webImage string = 'ghcr.io/limequizz/quizme-web:latest'
param extractorImage string = 'ghcr.io/limequizz/quizme-extractor:latest'
@description('Public https URL, e.g. https://<your-domain>. Empty uses the default Container Apps hostname.')
param publicUrl string = ''
param webIpSecurityRestrictions array = []
param webMinReplicas int = 0
param webMaxReplicas int = 3
param extractorMinReplicas int = 0
param extractorMaxReplicas int = 3
param postgresAdminLogin string = 'quizmeadmin'
param alertEmails array = []
param tags object = {}

var base = '${namePrefix}-${env}'
var allTags = union({ app: 'quizme', env: env }, tags)

module logs 'modules/monitoring.bicep' = {
  name: 'logs'
  params: { name: '${base}-logs', location: location, retentionInDays: 30, tags: allTags }
}

module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    name: '${base}-vnet'
    location: location
    postgresDnsZoneName: '${base}.private.postgres.database.azure.com'
    tags: allTags
  }
}

module webIdentity 'modules/identity.bicep' = {
  name: 'web-identity'
  params: { name: '${base}-web-id', location: location, tags: allTags }
}

module extractorIdentity 'modules/identity.bicep' = {
  name: 'extractor-identity'
  params: { name: '${base}-extractor-id', location: location, tags: allTags }
}

module vault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    name: keyVaultName
    location: location
    allowedSubnetId: network.outputs.appsSubnetId
    secretReaderPrincipalIds: [webIdentity.outputs.principalId, extractorIdentity.outputs.principalId]
    logAnalyticsWorkspaceId: logs.outputs.id
    tags: allTags
  }
}

module registry 'modules/registry.bicep' = if (!empty(registryName)) {
  name: 'registry'
  params: {
    name: registryName
    location: location
    pullerPrincipalIds: [webIdentity.outputs.principalId, extractorIdentity.outputs.principalId]
    logAnalyticsWorkspaceId: logs.outputs.id
    tags: allTags
  }
}

module environment 'modules/environment.bicep' = {
  name: 'environment'
  params: {
    name: '${base}-env'
    location: location
    infrastructureSubnetId: network.outputs.appsSubnetId
    logAnalyticsWorkspaceName: logs.outputs.name
    tags: allTags
  }
}

resource existingVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

module postgres 'modules/postgres.bicep' = if (!bootstrap) {
  name: 'postgres'
  params: {
    name: postgresServerName
    location: location
    administratorLogin: postgresAdminLogin
    // Read from Key Vault by ARM at deploy time; never in a parameter file.
    administratorPassword: existingVault.getSecret('postgres-admin-password')
    delegatedSubnetId: network.outputs.postgresSubnetId
    privateDnsZoneId: network.outputs.postgresDnsZoneId
    logAnalyticsWorkspaceId: logs.outputs.id
    tags: allTags
  }
  dependsOn: [vault]
}

module apps 'modules/apps.bicep' = if (!bootstrap) {
  name: 'apps'
  params: {
    location: location
    environmentId: environment.outputs.id
    environmentDefaultDomain: environment.outputs.defaultDomain
    webAppName: '${base}-web'
    extractorAppName: '${base}-extractor'
    webImage: webImage
    extractorImage: extractorImage
    registryServer: empty(registryName) ? '' : registry!.outputs.loginServer
    webIdentityId: webIdentity.outputs.id
    extractorIdentityId: extractorIdentity.outputs.id
    keyVaultUri: vault.outputs.uri
    publicUrl: publicUrl
    webIpSecurityRestrictions: webIpSecurityRestrictions
    webMinReplicas: webMinReplicas
    webMaxReplicas: webMaxReplicas
    extractorMinReplicas: extractorMinReplicas
    extractorMaxReplicas: extractorMaxReplicas
    tags: allTags
  }
  dependsOn: [postgres]
}

module alerts 'modules/alerts.bicep' = if (!bootstrap) {
  name: 'alerts'
  params: {
    namePrefix: base
    webAppId: apps!.outputs.webId
    extractorAppId: apps!.outputs.extractorId
    alertEmails: alertEmails
    tags: allTags
  }
}

output keyVaultName string = vault.outputs.name
output environmentName string = environment.outputs.name
output webAppName string = '${base}-web'
output extractorAppName string = '${base}-extractor'
output appUrl string = bootstrap ? '' : apps!.outputs.appUrl
output postgresFqdn string = bootstrap ? '' : postgres!.outputs.fqdn
output registryLoginServer string = empty(registryName) ? '' : registry!.outputs.loginServer
