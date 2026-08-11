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
// 这是本项目既有的约定，见 rtm-host.test.ts 与 TimelinePanel.test.ts。
import { describe, expect, it } from 'vitest';

import css from './styles.css?raw';

/** 取某个选择器的规则体。选择器在文件里唯一时才有意义。 */
function ruleBody(selector: string): string {
  const index = css.indexOf(`${selector} {`);
  expect(index, `样式表里找不到选择器 ${selector}`).toBeGreaterThan(-1);
  return css.slice(index, css.indexOf('}', index));
}

describe('语聊房布局数值（spec 已两轮确认，不要回退）', () => {
  it('手机高度取 812px 与「视口高度 - 210px」的较小值', () => {
    // 固定值或百分比都不行：前者在小屏上裁切，后者拿不到外壳两级 tab 与告警条的高度。
    expect(ruleBody('.vr-phone')).toContain('height: min(812px, calc(100vh - 210px))');
  });

  it('麦位方框最小高度 76px', () => {
    expect(ruleBody('.vr-seat')).toContain('min-height: 76px');
  });

  it('麦位头像 26px', () => {
    const avatar = ruleBody('.vr-seat__avatar');
    expect(avatar).toContain('width: 26px');
    expect(avatar).toContain('height: 26px');
  });

  it('麦位网格 4 列', () => {
    expect(ruleBody('.vr-seats')).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
  });

  it('窄屏断点是 1240px', () => {
    expect(css).toContain('@media (max-width: 1240px)');
  });
});

describe('手机内只有公屏滚动', () => {
  /** 语聊房那一段样式。外壳的规则（两级 tab 横向滚动等）不在本约束范围内。 */
  const sceneCss = css.slice(css.indexOf('.vr-scene {'));

  it('整台手机不滚动 —— 溢出被裁掉，靠内部区块自己让出空间', () => {
    expect(ruleBody('.vr-phone')).toContain('overflow: hidden');
  });

  it('公屏是唯一纵向滚动的区块', () => {
    // 逐条找出纵向可滚的规则，断言只有公屏一个。多出任何一条都会让「其余区块钉住」
    // 这条约束破功 —— 之前角色面板的申请列表就自带过一个 max-height + overflow-y。
    const scrollable = [...sceneCss.matchAll(/([^{}]+)\{([^}]*overflow-y:\s*(?:auto|scroll)[^}]*)\}/g)]
      .map((match) => match[1].trim().split('\n').pop()?.trim())
      .filter(Boolean);

    expect(scrollable).toEqual(['.vr-chat']);
  });

  it('公屏带 min-height: 0 —— 缺了它 flex 子项会被内容撑破，变成整台手机滚动', () => {
    expect(ruleBody('.vr-chat')).toContain('min-height: 0');
  });

  it('成员条只横向滚动，纵向不滚 —— spec 要求超出显示计数而不是滚动', () => {
    const memberBar = ruleBody('.vr-member-bar');
    expect(memberBar).toContain('overflow-x: auto');
    expect(memberBar).not.toContain('overflow-y');
  });
});
