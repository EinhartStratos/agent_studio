import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ModelInfo, SkillInfo } from './types';

interface ComposerProps {
  onSend: (text: string) => Promise<void>;
  models: ModelInfo[];
  selectedModel?: ModelInfo;
  onModelChange: (model: ModelInfo) => void;
  sending?: boolean;
  disabled?: boolean;
  skills?: SkillInfo[];
}

interface SkillTrigger {
  start: number;
  end: number;
  query: string;
}

function detectSkillTrigger(value: string, cursor: number): SkillTrigger | null {
  const before = value.slice(0, cursor);
  const match = before.match(/(?:^|\s)@(\S*)$/);
  if (!match) return null;
  const matchIndex = before.lastIndexOf(match[0]);
  const atIndex = before.slice(matchIndex).indexOf('@');
  return {
    start: matchIndex + atIndex,
    end: cursor,
    query: match[1] ?? '',
  };
}

export function Composer({
  onSend,
  models,
  selectedModel,
  onModelChange,
  sending,
  disabled,
  skills = [],
}: ComposerProps): ReactNode {
  const [text, setText] = useState('');
  const [showSkills, setShowSkills] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillIndex, setSkillIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredSkills = skills.filter((s) => {
    const q = skillQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    if (filteredSkills.length === 0) {
      setSkillIndex(0);
    } else if (skillIndex >= filteredSkills.length) {
      setSkillIndex(filteredSkills.length - 1);
    }
  }, [filteredSkills, skillIndex]);

  const submit = async () => {
    if (!text.trim() || disabled || sending) return;
    const t = text.trim();
    setText('');
    setShowSkills(false);
    try {
      await onSend(t);
    } catch (err) {
      // App.tsx 会刷新转录显示错误
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursor = e.target.selectionStart ?? value.length;
    setText(value);
    const trigger = detectSkillTrigger(value, cursor);
    if (trigger) {
      setSkillQuery(trigger.query);
      setSkillIndex(0);
      setShowSkills(true);
    } else {
      setShowSkills(false);
    }
  };

  const insertSkill = (skill: SkillInfo) => {
    const trigger = detectSkillTrigger(text, textareaRef.current?.selectionStart ?? text.length);
    if (!trigger) return;
    const replacement = `${skill.slashCommand} `;
    const newText = text.slice(0, trigger.start) + replacement + text.slice(trigger.end);
    setText(newText);
    setShowSkills(false);
    const pos = trigger.start + replacement.length;
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = pos;
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSkills && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSkillIndex((i) => (i + 1) % filteredSkills.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSkillIndex((i) => (i - 1 + filteredSkills.length) % filteredSkills.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filteredSkills[skillIndex]) insertSkill(filteredSkills[skillIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowSkills(false);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const modelOk = models.length > 0 && !!selectedModel;
  const statusText = sending ? '发送中…' : modelOk ? `当前: ${selectedModel?.label ?? selectedModel?.modelId}` : '模型: 未配置';

  return (
    <div
      className="relative border-t border-native-border bg-native-panel/80 backdrop-blur-xl z-[2]"
      style={{
        boxShadow:
          '0 -8px 32px -18px rgba(15,23,42,0.35), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <div className="mx-auto w-full max-w-4xl px-6 py-4">
        {/* 顶部状态条：模型状态 + 发送中提示 */}
        <div className="flex items-center justify-between mb-3 px-0.5">
          <div className="inline-flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                sending
                  ? 'bg-native-accent animate-pulse-soft'
                  : modelOk
                    ? 'bg-native-success'
                    : 'bg-native-danger'
              }`}
            />
            <span
              className={`text-[11.5px] font-medium tracking-wide ${
                sending
                  ? 'text-native-accent-hover'
                  : modelOk
                    ? 'text-native-success'
                    : 'text-native-danger'
              }`}
            >
              {statusText}
            </span>
          </div>

          {sending && (
            <div className="inline-flex items-center gap-2 text-[11.5px] text-native-muted">
              <span className="inline-flex gap-[3px]">
                <span className="w-1 h-1 rounded-full bg-native-accent/80 animate-bounce" />
                <span className="w-1 h-1 rounded-full bg-native-accent/80 animate-bounce" style={{ animationDelay: '120ms' }} />
                <span className="w-1 h-1 rounded-full bg-native-accent/80 animate-bounce" style={{ animationDelay: '240ms' }} />
              </span>
              请稍候，Agent 正在思考…
            </div>
          )}
        </div>

        {/* Skill 下拉 */}
        {showSkills && (
          <div className="absolute bottom-full left-0 right-0 mx-auto w-full max-w-4xl px-6 mb-2 z-20">
            <div className="glass-card max-h-[240px] overflow-auto p-2 animate-lift-in">
              {filteredSkills.length === 0 ? (
                <div className="px-3 py-5 text-center text-[12.5px] text-native-muted">
                  {skills.length === 0 ? (
                    <>
                      <div className="mb-1">
                        当前工作区没有加载 skill
                      </div>
                      <div className="text-[11px]">
                        将 skill 放在{' '}
                        <span className="font-mono text-[10.5px] chip chip-accent">
                          .pi/skills/skill-name/SKILL.md
                        </span>{' '}
                        下
                      </div>
                    </>
                  ) : (
                    <>没有匹配的 skill，尝试调整关键词。</>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {filteredSkills.map((skill, idx) => (
                    <button
                      key={skill.name}
                      type="button"
                      onClick={() => insertSkill(skill)}
                      className={`group w-full text-left rounded-2xl px-3 py-2.5 transition-all duration-140 ${
                        idx === skillIndex
                          ? 'shadow-soft'
                          : 'hover:bg-native-hover'
                      }`}
                      style={
                        idx === skillIndex
                          ? {
                              background:
                                'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(139,92,246,0.10))',
                              border: '1px solid rgba(99,102,241,0.22)',
                            }
                          : {
                              border: '1px solid transparent',
                            }
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-native-text">
                          <span className="chip chip-accent text-[10.5px] px-1.5 py-[1px]">
                            {skill.slashCommand}
                          </span>
                          {skill.name}
                        </span>
                        <span className="chip text-[10.5px]">
                          {skill.source}
                        </span>
                      </div>
                      <div className="mt-1 text-[11.8px] text-native-muted line-clamp-2 leading-relaxed">
                        {skill.description}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 模型选择器 */}
        <div className="mb-3 inline-flex items-center gap-2 flex-wrap">
          <div className="relative inline-flex items-center gap-2">
            <span className="text-[12px] text-native-muted font-medium">
              🤖 模型
            </span>
            <select
              value={
                selectedModel
                  ? `${selectedModel.providerId}/${selectedModel.modelId}`
                  : ''
              }
              onChange={(e) => {
                const [providerId, ...rest] = e.target.value.split('/');
                const modelId = rest.join('/');
                const model = models.find(
                  (m) => m.providerId === providerId && m.modelId === modelId
                );
                if (model) onModelChange(model);
              }}
              disabled={disabled || sending || models.length === 0}
              className="appearance-none inline-flex items-center pr-8 pl-3 py-1.5 rounded-xl text-[12.5px] font-medium transition-all focus:outline-none disabled:opacity-45"
              style={{
                background: 'var(--native-input-bg)',
                border: '1px solid var(--native-border)',
                color: 'var(--native-text)',
              }}
            >
              {models.length === 0 && <option value="">无可用模型</option>}
              {models.map((m) => (
                <option
                  key={`${m.providerId}/${m.modelId}`}
                  value={`${m.providerId}/${m.modelId}`}
                >
                  {m.label ?? m.modelId} · {m.providerId}
                </option>
              ))}
            </select>
            <span
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-native-muted"
              aria-hidden
            >
              ▾
            </span>
          </div>

          <div className="chip text-[10.5px]">
            ⌨️ <span>Ctrl/⌘ + Enter 发送</span>
          </div>
          <div className="chip text-[10.5px]">
            <span>@</span> <span>调用 Skill</span>
          </div>
        </div>

        {/* 输入框 + 发送按钮 */}
        <div className="relative">
          <div
            className="absolute -inset-px rounded-[22px] pointer-events-none opacity-70"
            aria-hidden
            style={{
              background:
                'linear-gradient(135deg, rgba(99,102,241,0.55), rgba(139,92,246,0.45) 45%, rgba(14,165,233,0.45) 100%)',
              filter: 'blur(0.2px)',
            }}
          />
          <div
            className="relative rounded-[21px] flex items-end gap-2 p-1.5"
            style={{
              background: 'var(--native-bg)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.04), 0 14px 40px -24px rgba(99,102,241,0.45)',
            }}
          >
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder={
                disabled
                  ? '请先创建或选择一个会话…'
                  : '输入你的工作需求（Ctrl/⌘ + Enter 发送），输入 @ 可唤起 Skill 面板…'
              }
              disabled={disabled || sending}
              className="flex-1 min-h-[46px] max-h-[200px] resize-none px-3.5 py-2.5 rounded-[16px] text-[13.8px] leading-[1.8] text-native-text placeholder:text-native-muted/80 focus:outline-none disabled:opacity-45"
              style={{
                background: 'transparent',
                border: '0 solid transparent',
              }}
            />
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !text.trim() || sending}
              className={`group/btn relative shrink-0 self-end inline-flex items-center gap-1.5 rounded-2xl px-4 py-2.5 text-[13px] font-semibold text-white transition-all duration-180 focus:outline-none ${
                disabled || !text.trim() || sending
                  ? 'opacity-45 cursor-not-allowed hover:!transform-none hover:!filter-none'
                  : ''
              }`}
              style={{
                background:
                  'linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #8b5cf6 100%)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.18), 0 16px 36px -18px rgba(99,102,241,0.75)',
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
              {sending ? (
                <span className="relative inline-flex items-center gap-2">
                  <span className="inline-flex gap-[3px]">
                    <span className="w-1 h-1 rounded-full bg-white/90 animate-bounce" />
                    <span className="w-1 h-1 rounded-full bg-white/90 animate-bounce" style={{ animationDelay: '120ms' }} />
                    <span className="w-1 h-1 rounded-full bg-white/90 animate-bounce" style={{ animationDelay: '240ms' }} />
                  </span>
                  <span>发送中</span>
                </span>
              ) : (
                <span className="relative inline-flex items-center gap-1.5">
                  <span>发送</span>
                  <span className="text-[13px]">↵</span>
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
