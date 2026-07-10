import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { AzureOpenAI } from 'openai';

/**
 * Azure OpenAI client for the in-app chat engine.
 *
 * The provisioned Foundry/Cognitive Services account has local API keys
 * disabled (disableLocalAuth = true), so we authenticate with Microsoft Entra
 * ID via DefaultAzureCredential — locally this uses your `az login` identity.
 */
const SCOPE = 'https://cognitiveservices.azure.com/.default';

let cached: { client: AzureOpenAI; deployment: string } | null = null;

export function getAiClient(): { client: AzureOpenAI; deployment: string } {
  if (cached) return cached;

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-5-mini';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21';
  if (!endpoint) {
    throw new Error(
      'Chat is not configured. Set AZURE_OPENAI_ENDPOINT (and AZURE_OPENAI_DEPLOYMENT) in the root .env.',
    );
  }

  const azureADTokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), SCOPE);
  const client = new AzureOpenAI({ endpoint, apiVersion, deployment, azureADTokenProvider });
  cached = { client, deployment };
  return cached;
}
