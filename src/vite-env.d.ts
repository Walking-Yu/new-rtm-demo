/// <reference types="vite/client" />

/*
 * Vite 的客户端类型声明。提供两样整个 `src/` 都依赖的东西：
 *
 * 1. `import.meta.env` —— `app/envSnapshot.ts` 读构建期注入的 `VITE_APP_ID`。
 * 2. `?raw` 后缀导入 —— 多处测试用它把源码当字符串读进来做静态断言，
 *    其中 `rtm-host.test.ts` / `rtm-audience.test.ts` 的「零依赖」用例
 *    正是靠 `?raw` 扫 import 语句守住那条铁律的。
 *
 * 这一行原先住在 `src/legacy/vite-env.d.ts`，却服务整个 `src/`。遗留实验室
 * 搬去 `new-rtm-demo-legacy` 时它跟着走了，`tsc -b` 立刻报 7 个错（`import.meta.env`
 * 不存在、`?raw` 模块找不到）。**不要再把它放进任何某一个场景或子目录里** ——
 * 它是全 `src/` 的公共声明，就该住在 `src/` 根下。
 */
