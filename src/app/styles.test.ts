/**
 * 样式表回归测试。
 *
 * ## 为什么要用读文本的方式测 CSS
 *
 * spec「语聊房主区布局」里的几个数值**已经用户两轮修改确认，并明确写了「不要回退」**。
 * 它们不是审美偏好，是约束：手机在小视口下不能被裁切、底部输入条必须常驻框内、
 * 只有公屏能滚。jsdom 不做布局也不算层叠样式，`getComputedStyle` 拿不到这些值，
 * 所以只能直接断言样式表文本。
 *
 * 这样测确实脆 —— 改写选择器就会红。但**红在这里正是目的**：它逼改的人回来看一眼
 * spec，确认自己是有意改这些数值，而不是顺手调格式时把它们带偏了。
 */

// 取源码文本用 Vite 的 `?raw`，不用 node:fs —— `tsconfig.app.json` 的 `types` 里
// 没有 `node`（app 代码是浏览器包，不该看见 `process`），用 node API 会让 `tsc -b` 红。
// 这是本项目既有的约定，见 roleBundleArchitecture.test.ts 与 TimelinePanel.test.ts。
import { describe, expect, it } from 'vitest';

import css from './styles.css?raw';

/** 取某个选择器的规则体。选择器在文件里唯一时才有意义。 */
function ruleBody(selector: string): string {
  const index = css.indexOf(`${selector} {`);
  expect(index, `样式表里找不到选择器 ${selector}`).toBeGreaterThan(-1);
  return css.slice(index, css.indexOf('}', index));
}

describe('原型外壳视觉契约', () => {
  it('一级 tab 使用底部蓝色指示线，不使用深色药丸背景', () => {
    const tab = ruleBody('.lab-tab--primary');
    const active = ruleBody(".lab-tab--primary[data-active='true']");

    expect(tab).toContain('border-bottom: 2px solid transparent');
    expect(active).toContain('border-bottom-color: var(--lab-indigo)');
    expect(active).not.toContain('background: var(--lab-ink)');
  });

  it('导航与语聊房入口遵循紧凑字号层级', () => {
    expect(css).toContain('--lab-text-display: 22px');
    expect(css).toContain('--lab-text-title: 17px');
    expect(css).toContain('--lab-text-section: 14px');
    expect(css).toContain('--lab-text-body: 12px');
    expect(css).toContain('--lab-text-nav-primary: 12px');
    expect(css).toContain('--lab-text-nav-secondary: 11px');
    expect(css).toContain('--lab-text-meta: 10px');

    expect(ruleBody('.lab-tab--primary')).toContain('font-size: var(--lab-text-nav-primary)');
    expect(ruleBody('.lab-tab--secondary')).toContain('font-size: var(--lab-text-nav-secondary)');
    expect(css).toMatch(/\.vr-entry--landing h1 \{[\s\S]*?font-size: var\(--lab-text-display\)/);
    expect(css).toContain('.vr-entry__choice strong { color: #31374b; font-size: var(--lab-text-section); }');
  });

  it('时间线在桌面端按原型粘在视口内', () => {
    expect(css).toMatch(
      /\.lab-timeline \{\s+position: sticky;\s+top: 16px;[\s\S]*?height: calc\(100vh - 166px\)/,
    );
  });

  it('时间线操作紧随图例左对齐，不自动推到右侧', () => {
    const actions = ruleBody('.lab-timeline__actions');

    expect(actions).not.toContain('margin-left: auto');
  });

  it('时间线色点与时间戳顶部对齐，不随多行摘要垂直居中', () => {
    const dot = ruleBody('.lab-trace__dot');

    expect(dot).toContain('align-self: start');
    expect(dot).toContain('margin-top: 4px');
  });

  it('中等宽度仍保持房间与数据流双栏，窄屏才改为单列', () => {
    expect(css).toContain('@media (max-width: 960px)');
    expect(css).not.toContain('@media (max-width: 1240px) {\n  .lab-body,');
  });

  it('单端房间在桌面端以受控高度布局，避免麦位把页面撑出首屏', () => {
    expect(css).toMatch(/\.vr-single \{[\s\S]*?height: min\(680px, calc\(100vh - 166px\)\)/);
    expect(css).toContain('grid-template-rows: auto auto auto minmax(0, 1fr) 62px;');
  });

});

describe('语聊房局部滚动', () => {
  it('单角色房间容器不滚动，溢出由内部区块承接', () => {
    expect(css).toMatch(/\.vr-single \{[^}]*overflow: hidden;/);
  });

  it('角色面板、入口列表和公屏分别承载自己的溢出内容', () => {
    expect(ruleBody('.vr-single__panel')).toContain('overflow-y: auto');
    expect(ruleBody('.vr-entry--landing')).toContain('overflow-y: auto');
    expect(css).toMatch(/\.vr-single__chat > div \{[^}]*overflow: auto;/);
  });

  it('控制台成员 UID 可截断，同时保留踢出与封禁按钮宽度', () => {
    expect(ruleBody('.vr-single__member-row')).toContain('grid-template-columns: minmax(0, 1fr) auto auto');
    expect(ruleBody('.vr-single__member-row small')).toContain('text-overflow: ellipsis');
  });

  it('麦位有宽高上限，较高视口的剩余空间由公屏承接', () => {
    expect(css).toMatch(/\.vr-single__seat \{[^}]*max-width: 160px;[^}]*max-height: 86px;/);
    expect(css).toMatch(/\.vr-single__chat-feed \{[^}]*max-height: none !important;/);
  });

  it('房间视角不设固定最大宽度，和数据流看板共同随页面变宽', () => {
    expect(ruleBody('.lab-body')).toContain('max-width: none');
    expect(css).toMatch(/\.vr-single \{[^}]*width: 100%;[^}]*max-width: none;/);
  });

  it('公屏网格允许内容收缩，避免撑破整个房间容器', () => {
    expect(css).toMatch(/\.vr-single__chat \{[^}]*min-height: 0;/);
    expect(css).toMatch(/\.vr-single__chat-feed \{[^}]*min-height: 0;/);
  });
});
