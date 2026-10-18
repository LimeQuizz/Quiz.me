@description('Key Vault name (globally unique, 3-24 characters).')
param name string
param location string
@description('Subnet allowed through the Key Vault firewall (the Container Apps subnet).')
param allowedSubnetId string
@description('Principal IDs that get "Key Vault Secrets User" (read secrets).')
param secretReaderPrincipalIds array
param logAnalyticsWorkspaceId string
param tags object = {}

// Built-in role: Key Vault Secrets User.
var secretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    // Lets ARM read the PostgreSQL admin password during a deployment.
    enabledForTemplateDeployment: true
    // The firewall denies everything except the Container Apps subnet.
    // "AzureServices" keeps ARM template deployments working; operators add
    // their own IP temporarily when seeding secrets.
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
      ipRules: []
      virtualNetworkRules: [
        { id: allowedSubnetId, ignoreMissingVnetServiceEndpoint: false }
      ]
    }
  }
}

resource readers 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in secretReaderPrincipalIds: {
    scope: vault
    name: guid(vault.id, principalId, secretsUserRoleId)
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsUserRoleId)
      principalId: principalId
      principalType: 'ServicePrincipal'
    }
  }
]

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: vault
  name: 'to-log-analytics'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [{ categoryGroup: 'audit', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

output id string = vault.id
output name string = vault.name
output uri string = vault.properties.vaultUri
