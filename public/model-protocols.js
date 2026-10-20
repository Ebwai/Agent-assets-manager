export const modelProtocols = [
  { id: 'anthropic', name: 'Anthropic Messages', baseUrl: 'https://api.anthropic.com', example: 'claude-sonnet-4-5' },
  { id: 'openai-chat', name: 'OpenAI Chat Completions', baseUrl: 'https://api.openai.com/v1', example: '服务商提供的模型 ID' },
  { id: 'openai-responses', name: 'OpenAI Responses', baseUrl: 'https://api.openai.com/v1', example: '服务商提供的模型 ID' },
  { id: 'gemini', name: 'Gemini generateContent', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', example: 'gemini-2.5-flash' }
];

export function modelProtocol(model) {
  return model.protocol || 'anthropic';
}
