import type { ReactNode } from 'react';
import type { AgentTemplate } from './types';

const BUILTIN_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'requirement-splitter',
    name: '需求拆解大师',
    emoji: '🧩',
    description: '把模糊的产品需求自动拆成「核心目标 / 功能模块 / 任务清单 / 验收标准 / 风险点」5 段结构化输出，P0/P1/P2 分级明确。',
    presetSkillNames: [],
  },
];

export function AgentMarket({ onUseAgent }: { onUseAgent: (agent: AgentTemplate) => void }): ReactNode {
  return (
    <div className="h-full w-full overflow-auto bg-neutral-950 text-white">
      <div className="mx-auto max-w-6xl px-8 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">🧩 智能体市场</h1>
          <p className="text-sm text-neutral-400 mt-2">
            选择一个智能体，它会配备专属的 system prompt 和预设 skill，在专属会话中为您工作。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {BUILTIN_AGENT_TEMPLATES.map((agent) => (
            <div
              key={agent.id}
              className="group relative overflow-hidden rounded-xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950 hover:border-violet-500/60 hover:shadow-[0_6px_40px_-12px_rgba(139,92,246,0.35)] transition-all duration-200"
            >
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-violet-500/10 blur-3xl group-hover:bg-violet-500/20 transition-colors pointer-events-none" />
              <div className="relative p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 via-indigo-500/25 to-sky-500/25 border border-white/5 text-3xl shadow-inner">
                    <span className="drop-shadow-[0_2px_8px_rgba(139,92,246,0.35)]">{agent.emoji ?? '🤖'}</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-lg font-semibold leading-tight">{agent.name}</div>
                    <div className="mt-0.5 text-[11px] uppercase tracking-wider text-violet-300/90">
                      Agent
                    </div>
                  </div>
                </div>

                <p className="text-sm leading-relaxed text-neutral-300 min-h-[4.5rem]">
                  {agent.description}
                </p>

                {Array.isArray(agent.presetSkillNames) && agent.presetSkillNames.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {agent.presetSkillNames.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-200"
                      >
                        🛠️ {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center rounded-full border border-neutral-700 bg-neutral-800/60 px-2 py-0.5 text-[11px] font-medium text-neutral-300">
                      🎯 定制 System Prompt
                    </span>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => onUseAgent(agent)}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 active:from-violet-600 active:to-indigo-700 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_-4px_rgba(99,102,241,0.55)] transition-all focus:outline-none focus:ring-2 focus:ring-violet-400/60"
                  >
                    <span>🚀</span>
                    <span>使用此智能体</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 text-xs text-neutral-500 text-center">
          更多智能体即将上线 · 所有智能体与普通会话共用 Timeline，交互习惯保持一致。
        </div>
      </div>
    </div>
  );
}
