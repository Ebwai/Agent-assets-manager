export function codexModelCatalog(mapping) {
  // Generic metadata must not inherit GPT-only tools, transports or reasoning defaults.
  const models = mapping.models.map((row, priority) => ({
    slug: row.id,
    display_name: row.label === row.id ? row.id : `${row.label} (${row.id})`,
    description: `供应商模型：${row.id}`,
    default_reasoning_level: row.reasoning === 'standard' ? 'medium' : 'none',
    supported_reasoning_levels: row.reasoning === 'standard' ? ['low', 'medium', 'high'].map(effort => ({ effort, description: effort })) : [],
    shell_type: 'shell_command', visibility: 'list', supported_in_api: true, priority,
    upgrade: null,
    base_instructions: 'You are a coding assistant. Follow the user instructions and use the available tools when needed. Do not claim a tool ran unless it returned a result.',
    support_verbosity: false, default_verbosity: null, apply_patch_tool_type: null,
    truncation_policy: { mode: 'tokens', limit: 10000 },
    context_window: row.contextWindow, effective_context_window_percent: 95,
    input_modalities: ['text'], experimental_supported_tools: [],
    supports_search_tool: false, use_responses_lite: false, multi_agent_version: 'v1'
  }));
  const text = JSON.stringify({ models }, null, 2) + '\n';
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('模型目录超过 1 MiB，请减少目标软件列表中的模型');
  return text;
}
