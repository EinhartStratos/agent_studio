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

export function AgentMarket({
  onUseAgent,
}: {
  onUseAgent: (agent: AgentTemplate) => void;
}): ReactNode {
  return (
    <div className="relative h-full w-full overflow-auto text-native-text">
      {/* 页面顶部柔和光效，和 body mesh 呼应 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-56"
        style={{
          background:
            'radial-gradient(900px 260px at 20% 0%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(700px 220px at 85% 10%, rgba(236,72,153,0.10), transparent 55%)',
          maskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
        }}
      />

      <div className="relative mx-auto w-full max-w-6xl px-10 py-10">
        {/* 头部 Hero 区 */}
        <header className="animate-lift-in">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="chip chip-accent mb-3">
                <span>🧩</span>
                <span>Agent Marketplace</span>
              </div>
              <h1 className="text-[30px] leading-tight font-semibold tracking-tight">
                智能体市场
              </h1>
              <p className="mt-2 max-w-2xl text-[13.5px] text-native-muted leading-relaxed">
                每个智能体都预设有专属的
                <span className="mx-1 chip chip-accent text-[10.5px] py-0 px-2">
                  System Prompt
                </span>
                与技能栈，在专属会话中为您稳定输出高质量结果。
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="chip">
                <span>✨</span>
                <span>内置 {BUILTIN_AGENT_TEMPLATES.length}</span>
              </span>
              <span className="chip">
                <span>⚙️</span>
                <span>与普通会话交互一致</span>
              </span>
            </div>
          </div>
        </header>

        {/* 卡片列表（更宽大的大卡平铺 · 消除右侧空白） */}
        <section className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {BUILTIN_AGENT_TEMPLATES.map((agent, idx) => (
            <article
              key={agent.id}
              className="group relative overflow-hidden rounded-3xl glass-card animate-lift-in min-h-[440px]"
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              {/* 背景：低饱和多层渐变光晕，更柔和护眼 */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-0 transition-opacity duration-300 opacity-90 group-hover:opacity-100"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(129,140,248,0.16) 0%, rgba(167,139,250,0.13) 42%, rgba(251,207,232,0.07) 100%)',
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -top-16 -right-16 w-[280px] h-[280px] rounded-full blur-3xl transition-all duration-300"
                style={{
                  background:
                    'radial-gradient(closest-side, rgba(167,139,250,0.45), transparent 70%)',
                  opacity: 0.55,
                  transform: 'translate3d(0,0,0)',
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-20 -left-20 w-[320px] h-[320px] rounded-full blur-3xl transition-all duration-300"
                style={{
                  background:
                    'radial-gradient(closest-side, rgba(96,165,250,0.35), transparent 70%)',
                  opacity: 0.35,
                }}
              />

              <div className="relative p-8 flex flex-col h-full">
                {/* 顶部 Icon + 标题 */}
                <div className="flex items-start gap-5">
                  <div
                    className="relative shrink-0 w-20 h-20 rounded-3xl flex items-center justify-center text-[42px] shadow-glow-violet"
                    style={{
                      background:
                        'linear-gradient(145deg, rgba(167,139,250,0.20), rgba(99,102,241,0.12) 55%, rgba(56,189,248,0.12))',
                      border: '1px solid rgba(129,140,248,0.24)',
                      boxShadow:
                        'inset 0 1px 0 rgba(255,255,255,0.08), 0 14px 36px -16px rgba(167,139,250,0.50)',
                    }}
                  >
                    <span
                      className="drop-shadow-[0_2px_12px_rgba(167,139,250,0.40)]"
                      style={{ transform: 'translateY(-1px)' }}
                    >
                      {agent.emoji ?? '🤖'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-[22px] font-semibold tracking-tight truncate">
                        {agent.name}
                      </h3>
                    </div>
                    <div className="chip chip-accent">
                      <span className="text-[11px]">AGENT</span>
                      <span className="text-[11px]">·</span>
                      <span className="text-[11px]">v1.0</span>
                    </div>
                  </div>
                </div>

                {/* 简介（更大行高，更易读） */}
                <p className="relative mt-6 text-[14.5px] leading-[1.9] text-native-text/90">
                  {agent.description}
                </p>

                {/* 标签 */}
                <div className="mt-5 flex flex-wrap gap-2">
                  {Array.isArray(agent.presetSkillNames) &&
                  agent.presetSkillNames.length > 0 ? (
                    agent.presetSkillNames.map((name) => (
                      <span
                        key={name}
                        className="chip chip-accent text-[11.5px] px-2.5 py-1"
                      >
                        🛠️ <span>{name}</span>
                      </span>
                    ))
                  ) : (
                    <>
                      <span className="chip chip-accent text-[11.5px] px-2.5 py-1">
                        🎯 定制 System Prompt
                      </span>
                      <span className="chip text-[11.5px] px-2.5 py-1">
                        📋 5 段结构化输出
                      </span>
                    </>
                  )}
                </div>

                {/* 底部：使用按钮 + hover 位移光效（尺寸放大，更有存在感） */}
                <div className="relative mt-auto pt-6">
                  <div className="soft-divider -mx-1 mb-5 opacity-80" />
                  <button
                    type="button"
                    onClick={() => onUseAgent(agent)}
                    className="group/btn relative w-full inline-flex items-center justify-center gap-2.5 rounded-2xl px-5 py-3.5 text-[14.5px] font-semibold text-white shadow-lift transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-violet-400/35"
                    style={{
                      background:
                        'linear-gradient(135deg, #6366f1 0%, #818cf8 50%, #a78bfa 100%)',
                    }}
                  >
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-2xl opacity-0 group-hover/btn:opacity-100 transition-opacity"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.02))',
                      }}
                    />
                    <span className="relative text-[16px]">🚀</span>
                    <span className="relative tracking-wide">使用此智能体</span>
                    <span
                      className="relative text-[14px] opacity-80 transition-transform duration-200 group-hover/btn:translate-x-0.5"
                    >
                      →
                    </span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>

        {/* 底部说明 */}
        <footer className="mt-14 flex items-center justify-center">
          <div className="chip max-w-2xl text-center">
            <span>🪐</span>
            <span>
              更多智能体即将上线 · 所有智能体与普通会话共用 Timeline，交互习惯保持一致
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
