@description('Log Analytics workspace name.')
param name string
param location string
param retentionInDays int = 30
param tags object = {}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: retentionInDays
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

output id string = workspace.id
output name string = workspace.name
output customerId string = workspace.properties.customerId
