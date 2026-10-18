@description('PostgreSQL Flexible Server name (globally unique).')
param name string
param location string
param administratorLogin string
@secure()
param administratorPassword string
param databaseName string = 'quizme'
param delegatedSubnetId string
param privateDnsZoneId string
param skuName string = 'Standard_B1ms'
param skuTier string = 'Burstable'
param storageSizeGB int = 32
param backupRetentionDays int = 7
param logAnalyticsWorkspaceId string
param tags object = {}

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: skuName, tier: skuTier }
  properties: {
    version: '16'
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    authConfig: { passwordAuth: 'Enabled', activeDirectoryAuth: 'Disabled' }
    storage: { storageSizeGB: storageSizeGB, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: backupRetentionDays, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    // Private access (VNet integration): no public endpoint exists.
    network: {
      delegatedSubnetResourceId: delegatedSubnetId
      privateDnsZoneArmResourceId: privateDnsZoneId
      publicNetworkAccess: 'Disabled'
    }
  }
}

resource requireTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: { value: 'on', source: 'user-override' }
}

resource minTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'ssl_min_protocol_version'
  properties: { value: 'TLSv1.2', source: 'user-override' }
  dependsOn: [requireTls]
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
  dependsOn: [minTls]
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: server
  name: 'to-log-analytics'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

output fqdn string = server.properties.fullyQualifiedDomainName
output name string = server.name
output databaseName string = database.name
