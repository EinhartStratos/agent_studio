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
    <div className="border-t border-native-border p-3 bg-native-panel relative">
      {showSkills && (
        <div className="absolute bottom-full left-3 right-3 mb-1 max-h-48 overflow-auto rounded bg-native-panel border border-native-border shadow-lg z-10">
          {filteredSkills.length === 0 ? (
            <div className="px-3 py-2 text-xs text-native-muted">
              {skills.length === 0 ? '当前工作区没有加载 skill' : '没有匹配的 skill'}
              <div className="text-[10px] opacity-70 mt-1">将 skill 放在 &quot;.pi/skills/&lt;skill-name&gt;/SKILL.md&quot; 下</div>
            </div>
          ) : (
            filteredSkills.map((skill, idx) => (
              <button
                key={skill.name}
                type="button"
                onClick={() => insertSkill(skill)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 flex flex-col gap-0.5 ${
                  idx === skillIndex ? 'bg-white/10' : ''
                }`}
              >
                <span className="font-medium text-native-text">{skill.name}</span>
                <span className="text-xs text-native-muted truncate">{skill.description}</span>
              </button>
            ))
          )}
        </div>
      )}
      <div className="flex items-center justify-between text-[11px] text-native-muted mb-2 px-1">
        <span className={sending ? 'text-blue-400' : modelOk ? 'text-green-400' : 'text-red-400'}>{statusText}</span>
        {sending && <span className="animate-pulse">请稍候</span>}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <select
          value={selectedModel ? `${selectedModel.providerId}/${selectedModel.modelId}` : ''}
          onChange={(e) => {
            const [providerId, ...rest] = e.target.value.split('/');
            const modelId = rest.join('/');
            const model = models.find((m) => m.providerId === providerId && m.modelId === modelId);
            if (model) onModelChange(model);
          }}
          disabled={disabled || sending || models.length === 0}
          className="px-2 py-1 rounded bg-black/30 border border-native-border text-xs focus:outline-none focus:border-native-accent disabled:opacity-40"
        >
          {models.length === 0 && <option value="">无可用模型</option>}
          {models.map((m) => (
            <option key={`${m.providerId}/${m.modelId}`} value={`${m.providerId}/${m.modelId}`}>
              {m.label ?? m.modelId} ({m.providerId})
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? '请先创建或选择会话' : '输入消息（Ctrl/Cmd + Enter 发送），输入 @ 调用 skill...'}
          disabled={disabled || sending}
          className="flex-1 min-h-[60px] max-h-[160px] resize-y px-3 py-2 rounded bg-black/30 border border-native-border focus:outline-none focus:border-native-accent text-sm disabled:opacity-40"
        />
        <button
          onClick={submit}
          disabled={disabled || !text.trim() || sending}
          className="self-end px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-sm font-medium transition-colors"
        >
          {sending ? '…' : '发送'}
        </button>
      </div>
    </div>
  );
}
