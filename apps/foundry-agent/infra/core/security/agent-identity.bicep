targetScope = 'resourceGroup'

@description('The location used for all deployed resources')
param location string = resourceGroup().location

@description('Tags that will be applied to all resources')
param tags object = {}

@description('Resource name for the user-assigned managed identity')
param resourceName string

// User-assigned managed identity for the hosted agent.
//
// Purpose: this identity is federated onto the Entra Agent ID *blueprint* as a
// federated identity credential (FIC), so the agent can obtain Entra tokens with
// NO stored secret (Zero Trust). The agent runtime already authenticates with
// DefaultAzureCredential() (see main.py), which picks this identity up once it is
// assigned to the agent's compute.
//
// The FIC on the blueprint uses:
//   subject   = this identity's principalId  (see output below)
//   issuer    = https://login.microsoftonline.com/<tenant-id>/v2.0
//   audiences = ["api://AzureADTokenExchange"]
resource agentIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: resourceName
  location: location
  tags: tags
}

output principalId string = agentIdentity.properties.principalId
output clientId string = agentIdentity.properties.clientId
output resourceId string = agentIdentity.id
output name string = agentIdentity.name
