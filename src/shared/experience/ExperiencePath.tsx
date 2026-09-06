import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Check, ChevronLeft, Code2, Compass, ExternalLink, Route } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { ExperienceProgress, ExperienceScenario, ExperienceStep } from './types';

const resources = [
  { label: '产品简介', href: 'https://doc.shengwang.cn/doc/rtm2/javascript/landing-page', Icon: BookOpen },
  { label: '最佳实践', href: 'https://doc.shengwang.cn/doc/rtm2/javascript/user-guide/link/link-basic', Icon: Compass },
  { label: 'API参考', href: 'https://doc.shengwang.cn/api-ref/rtm2/javascript/toc-configuration/configuration', Icon: Code2 },
] as const;

function StepHelp({ step, children }: { step: ExperienceStep; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const hide = () => { closeTimer.current = setTimeout(() => setOpen(false), 120); };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!open || !button.current || !tooltip.current) return;
    const anchor = button.current.getBoundingClientRect();
    const box = tooltip.current.getBoundingClientRect();
    const left = anchor.right + 10 + box.width <= window.innerWidth - 12
      ? anchor.right + 10 : Math.max(12, anchor.left - box.width - 10);
    setPosition({ left, top: Math.max(12, Math.min(anchor.top, window.innerHeight - box.height - 12)) });
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [open]);
  return <>
    <button ref={button} type="button" className="experience-step__button"
      aria-describedby={open ? `experience-help-${step.id}` : undefined}
      onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
      onClick={show} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
      {children}
    </button>
    {open && createPortal(<div ref={tooltip} id={`experience-help-${step.id}`} role="tooltip"
      className="experience-step__tooltip" style={position} onMouseEnter={show} onMouseLeave={hide}>
      <p>{step.instruction}</p><span className="experience-step__capability">{step.capability}</span>
    </div>, document.body)}
  </>;
}

/** Shared three-section guide. Only its configuration and reported evidence vary by scene. */
export function ExperiencePath({ scenario, progress }: {
  scenario?: ExperienceScenario;
  progress?: ExperienceProgress;
}) {
  const [collapsed, setCollapsed] = useState(() => window.matchMedia?.('(max-width: 800px)').matches ?? false);
  const steps = scenario?.steps ?? [];
  const evidence = new Set(progress?.scenarioId === scenario?.id ? progress?.milestones : []);
  const completed = steps.filter((step) => step.milestones.length > 0 && step.milestones.every((item) => evidence.has(item.id)));
  const current = steps.find((step) => !completed.includes(step));
  const ready = scenario?.status === 'ready';

  return (
    <>
    {!collapsed && <button className="experience-path__backdrop" aria-label="收起体验路径" onClick={() => setCollapsed(true)} />}
    <aside className="experience-path" aria-label="体验路径" data-collapsed={collapsed}>
      <button type="button" className="experience-path__toggle" aria-expanded={!collapsed}
        aria-controls="experience-path-content" onClick={() => setCollapsed((value) => !value)}>
        <span className="experience-path__identity"><Route size={19} aria-hidden="true" /><strong>体验路径</strong></span>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      {!collapsed && <div id="experience-path-content" className="experience-path__content">
        <section className="experience-path__tasks" aria-labelledby="experience-tasks-title">
          <div className="experience-path__section-title">
            <h2 id="experience-tasks-title"><span>01</span> 场景任务</h2>
            <span className="experience-path__count">{ready ? `${completed.length} / ${steps.length}` : '待开放'}</span>
          </div>
          <p className="experience-path__intro">{ready ? '跟着操作，理解实时互动如何发生。' : `${scenario?.label ?? '当前场景'}的体验任务正在准备中。`}</p>
          {ready ? <>
            <div className="experience-path__progress" role="progressbar" aria-label="场景任务完成进度"
              aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={completed.length}>
              <span style={{ width: `${steps.length ? completed.length / steps.length * 100 : 0}%` }} />
            </div>
            <ol className="experience-path__steps">
              {steps.map((step, index) => {
                const done = completed.includes(step);
                const partial = step.milestones.some((item) => evidence.has(item.id));
                const state = done ? 'complete' : partial ? 'partial' : current === step ? 'current' : 'pending';
                return <li key={`${scenario?.id}-${step.id}`} data-state={state}>
                  <StepHelp step={step}>
                    <span className="experience-step__number" aria-hidden="true">{done ? <Check size={13} /> : index + 1}</span>
                    <span className="experience-step__title">{step.title}</span>
                    <span className="experience-step__status">{done ? '已完成' : partial ? '进行中' : current === step ? '当前' : ''}</span>
                  </StepHelp>
                </li>;
              })}
            </ol>
          </> : <div className="experience-path__planned"><Route size={24} aria-hidden="true" /><p>先到语聊房，完成一次真实互动体验。</p></div>}
        </section>
        <section className="experience-path__section" aria-labelledby="experience-console-title">
          <div className="experience-path__section-title"><h2 id="experience-console-title"><span>02</span> 开始构建</h2></div>
          <a className="experience-path__console" href="https://console.shengwang.cn/" target="_blank" rel="noreferrer">
            前往 Console 创建项目 <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </section>
        <section className="experience-path__section" aria-labelledby="experience-docs-title">
          <div className="experience-path__section-title"><h2 id="experience-docs-title"><span>03</span> 开发文档</h2></div>
          <div className="experience-path__resources">
            {resources.map(({ label, href, Icon }) => <a key={label} href={href} target="_blank" rel="noreferrer" aria-label={label}>
              <Icon size={16} aria-hidden="true" /><span><strong>{label}</strong></span><ExternalLink size={12} aria-hidden="true" />
            </a>)}
          </div>
        </section>
      </div>}
    </aside>
    </>
  );
}
