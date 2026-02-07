export interface Role {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  capabilities: string[];
  systemPromptPreview: string;
  agentCount: number;
}
