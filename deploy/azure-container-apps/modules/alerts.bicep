param namePrefix string
param webAppId string
param extractorAppId string
@description('Email addresses for the action group. Empty creates the alerts without a receiver.')
param alertEmails array = []
@description('5xx responses from web within 5 minutes that fire the alert.')
param web5xxThreshold int = 10
@description('Extractor container restarts within 15 minutes that fire the alert.')
param extractorRestartThreshold int = 3
param tags object = {}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: '${namePrefix}-alerts'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: take(replace(namePrefix, '-', ''), 12)
    enabled: true
    emailReceivers: [
      for (email, i) in alertEmails: {
        name: 'email-${i}'
        emailAddress: email
        useCommonAlertSchema: true
      }
    ]
  }
}

resource web5xx 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${namePrefix}-web-5xx'
  location: 'global'
  tags: tags
  properties: {
    description: 'Web is returning 5xx responses.'
    severity: 2
    enabled: true
    scopes: [webAppId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'requests-5xx'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'Requests'
          dimensions: [{ name: 'statusCodeCategory', operator: 'Include', values: ['5xx'] }]
          operator: 'GreaterThan'
          threshold: web5xxThreshold
          timeAggregation: 'Total'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

resource extractorRestarts 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${namePrefix}-extractor-restarts'
  location: 'global'
  tags: tags
  properties: {
    description: 'Extractor containers are restarting (crashes, OOM kills, failed probes).'
    severity: 2
    enabled: true
    scopes: [extractorAppId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'restarts'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'RestartCount'
          operator: 'GreaterThan'
          threshold: extractorRestartThreshold
          timeAggregation: 'Total'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}
