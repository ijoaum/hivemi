export interface Role {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  capabilities: string[];
  systemPrompt: string;
  systemPromptPreview?: string;
  agentCount: number;
}
