param location string
param environmentId string
param environmentDefaultDomain string
param webAppName string
param extractorAppName string
@description('Full image reference for web, ideally pinned to the git sha tag or a digest.')
param webImage string
param extractorImage string
@description('Registry server to pull from with the managed identity, e.g. an ACR login server. Empty pulls anonymously (public GHCR).')
param registryServer string = ''
param webIdentityId string
param extractorIdentityId string
param keyVaultUri string
@description('Public https URL of the app. Empty uses the default Container Apps hostname.')
param publicUrl string = ''
@description('Optional ingress IP allow-list for web, as Container Apps ipSecurityRestrictions entries. Empty allows all.')
param webIpSecurityRestrictions array = []
param webMinReplicas int = 0
param webMaxReplicas int = 3
param extractorMinReplicas int = 0
param extractorMaxReplicas int = 3
param logLevel string = 'info'
param tags object = {}

var appUrl = empty(publicUrl) ? 'https://${webAppName}.${environmentDefaultDomain}' : publicUrl

// Key Vault secret names. The Container Apps platform reads them with the
// app's managed identity; values never appear in the template.
var webSecretNames = [
  'database-url'
  'migration-database-url'
  'auth-secret'
  'google-client-id'
  'google-client-secret'
  'microsoft-client-id'
  'microsoft-client-secret'
  'extractor-shared-secret'
]

func kvSecret(name string, vaultUri string, identityId string) object => {
  name: name
  keyVaultUrl: '${vaultUri}secrets/${name}'
  identity: identityId
}

resource extractor 'Microsoft.App/containerApps@2024-03-01' = {
  name: extractorAppName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${extractorIdentityId}': {} }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        // Internal only: reachable from apps in the same environment, never
        // from the internet.
        external: false
        targetPort: 8000
        transport: 'http'
        allowInsecure: false
      }
      registries: empty(registryServer) ? [] : [{ server: registryServer, identity: extractorIdentityId }]
      secrets: [kvSecret('extractor-shared-secret', keyVaultUri, extractorIdentityId)]
    }
    template: {
      containers: [
        {
          name: 'extractor'
          image: extractorImage
          resources: { cpu: json('1.0'), memory: '2Gi' }
          env: [
            { name: 'EXTRACTOR_SHARED_SECRET', secretRef: 'extractor-shared-secret' }
            { name: 'EXTRACTOR_TMP_DIR', value: '/tmp' }
            { name: 'EXTRACTOR_TIMEOUT_SECONDS', value: '60' }
            { name: 'EXTRACTOR_MAX_PAGES', value: '300' }
            { name: 'EXTRACTOR_OCR_DPI', value: '200' }
            { name: 'EXTRACTOR_MAX_CONCURRENCY', value: '2' }
            { name: 'EXTRACTOR_MEMORY_LIMIT_MB', value: '1536' }
          ]
          volumeMounts: [{ volumeName: 'scratch', mountPath: '/tmp' }]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: 8000 }
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/healthz', port: 8000 }
              periodSeconds: 10
            }
          ]
        }
      ]
      // Replica-local scratch space, discarded with the replica. Container
      // Apps has no tmpfs; the extractor still deletes every file in a
      // finally block.
      volumes: [{ name: 'scratch', storageType: 'EmptyDir' }]
      scale: {
        minReplicas: extractorMinReplicas
        maxReplicas: extractorMaxReplicas
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '2' } } }]
      }
    }
  }
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: webAppName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${webIdentityId}': {} }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        // HTTP requests are redirected to HTTPS.
        allowInsecure: false
        ipSecurityRestrictions: webIpSecurityRestrictions
      }
      registries: empty(registryServer) ? [] : [{ server: registryServer, identity: webIdentityId }]
      secrets: [for s in webSecretNames: kvSecret(s, keyVaultUri, webIdentityId)]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'AUTH_URL', value: appUrl }
            { name: 'EXTRACTOR_URL', value: 'https://${extractor.properties.configuration.ingress.fqdn}' }
            { name: 'LOG_LEVEL', value: logLevel }
            { name: 'RUN_MIGRATIONS', value: 'true' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'MIGRATION_DATABASE_URL', secretRef: 'migration-database-url' }
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            { name: 'AUTH_GOOGLE_ID', secretRef: 'google-client-id' }
            { name: 'AUTH_GOOGLE_SECRET', secretRef: 'google-client-secret' }
            { name: 'AUTH_MICROSOFT_ENTRA_ID_ID', secretRef: 'microsoft-client-id' }
            { name: 'AUTH_MICROSOFT_ENTRA_ID_SECRET', secretRef: 'microsoft-client-secret' }
            { name: 'EXTRACTOR_SHARED_SECRET', secretRef: 'extractor-shared-secret' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000 }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: webMinReplicas
        maxReplicas: webMaxReplicas
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }]
      }
    }
  }
}

output webId string = web.id
output extractorId string = extractor.id
output webFqdn string = web.properties.configuration.ingress.fqdn
output appUrl string = appUrl
