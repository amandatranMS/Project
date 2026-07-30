targetScope = 'subscription'

metadata description = 'Enables Microsoft Defender for Cloud threat protection for AI services (Defender for AI Services) on the subscription. Alerts integrate with Microsoft Defender XDR.'

@description('Pricing tier for the Defender for AI Services plan. Standard turns threat protection on; Free turns it off.')
@allowed([
  'Standard'
  'Free'
])
param pricingTier string = 'Standard'

@description('Include the offending prompt/response snippets in alerts (sensitive data auto-redacted). Only applies on the Standard tier.')
param enablePromptEvidence bool = true

@description('Enable the bridge that lets Microsoft Purview classify + apply DLP to AI model interactions. Only applies on the Standard tier. Requires a Purview license.')
param enablePurviewSharing bool = true

// Defender for Cloud plan for AI workloads (Azure AI Foundry / Azure OpenAI).
//
// This is what raises Defender XDR security alerts for our generative-AI workload
// — jailbreak / prompt-injection, sensitive-data leakage, credential theft, wallet
// abuse, and more. It works at the AIServices account level, so it covers BOTH the
// direct Azure OpenAI engine AND the Foundry hosted agent. Alerts surface in
// Defender for Cloud and flow to the Microsoft Defender XDR portal.
//
// Defender for AI Services includes a 30-day / 75-billion-token free trial.
// Enabling requires Owner or Contributor at subscription scope.
//
// The plan's component detectors are enabled declaratively via `extensions`
// (verified names from a live plan):
//   - AIModelScanner              core threat detection / activity monitoring
//   - AIPromptEvidence            include prompt/response snippets in alerts
//   - AIPromptSharingWithPurview  the bridge that lets Microsoft Purview classify +
//                                 apply DLP to model interactions (needs a license)
// Extensions only apply on the Standard tier; on Free the plan is turned off.
var standardExtensions = [
  {
    name: 'AIModelScanner'
    isEnabled: 'True'
  }
  {
    name: 'AIPromptEvidence'
    isEnabled: enablePromptEvidence ? 'True' : 'False'
  }
  {
    name: 'AIPromptSharingWithPurview'
    isEnabled: enablePurviewSharing ? 'True' : 'False'
  }
]

resource aiPlan 'Microsoft.Security/pricings@2024-01-01' = {
  name: 'AI'
  properties: pricingTier == 'Standard'
    ? {
        pricingTier: pricingTier
        extensions: standardExtensions
      }
    : {
        pricingTier: pricingTier
      }
}

output planName string = aiPlan.name
output pricingTier string = aiPlan.properties.pricingTier
