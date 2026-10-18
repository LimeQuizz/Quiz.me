@description('Azure Container Registry name (globally unique, alphanumeric).')
param name string
param location string
@description('Principal IDs that get AcrPull.')
param pullerPrincipalIds array
param logAnalyticsWorkspaceId string
param tags object = {}

// Built-in role: AcrPull.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource pullers 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in pullerPrincipalIds: {
    scope: registry
    name: guid(registry.id, principalId, acrPullRoleId)
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
      principalId: principalId
      principalType: 'ServicePrincipal'
    }
  }
]

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: registry
  name: 'to-log-analytics'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [{ categoryGroup: 'audit', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

output loginServer string = registry.properties.loginServer
output name string = registry.name
