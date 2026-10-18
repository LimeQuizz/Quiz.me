@description('Virtual network name.')
param name string
param location string
param addressPrefix string = '10.40.0.0/16'
@description('Subnet for the Container Apps environment (workload profiles need /27 or larger).')
param appsSubnetPrefix string = '10.40.0.0/23'
@description('Subnet delegated to PostgreSQL Flexible Server.')
param postgresSubnetPrefix string = '10.40.2.0/27'
@description('Private DNS zone name for PostgreSQL, ending in .private.postgres.database.azure.com.')
param postgresDnsZoneName string
param tags object = {}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [addressPrefix] }
    subnets: [
      {
        name: 'apps'
        properties: {
          addressPrefix: appsSubnetPrefix
          delegations: [
            { name: 'apps', properties: { serviceName: 'Microsoft.App/environments' } }
          ]
          // Lets the Key Vault firewall allow this subnet only.
          serviceEndpoints: [{ service: 'Microsoft.KeyVault' }]
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: postgresSubnetPrefix
          delegations: [
            { name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }
          ]
        }
      }
    ]
  }
}

resource dnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: postgresDnsZoneName
  location: 'global'
  tags: tags
}

resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: dnsZone
  name: '${name}-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

output vnetId string = vnet.id
output appsSubnetId string = vnet.properties.subnets[0].id
output postgresSubnetId string = vnet.properties.subnets[1].id
output postgresDnsZoneId string = dnsZone.id
