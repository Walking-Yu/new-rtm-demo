/**
 * env 未配置时的引导页。
 *
 * 刻意**不是报错页** —— 未配置不是异常，是尚未配置。措辞不用报错口吻
 * （见 spec「配置注入」与票 06 的 Answer）。
 */

const LOCAL_SNIPPET = 'VITE_APP_ID=你的 App ID';

const INJECT_SNIPPET = `<script>window.__ENV__ = { appId: '你的 App ID' };</script>
<script type="module" src="/assets/index.js"></script>`;

export function EnvGuide() {
  return (
    <div className="lab-guide" data-testid="env-guide">
      <h1 className="lab-guide__title">还没有配置 App ID</h1>
      <p className="lab-guide__lead">
        实验室需要一个声网 App ID 才能连接。按下面任一种方式配置后刷新页面即可。
      </p>

      <section className="lab-guide__section">
        <h2 className="lab-guide__subtitle">本地开发</h2>
        <p>在仓库根目录的 .env 文件里写入：</p>
        <pre className="lab-guide__code">{LOCAL_SNIPPET}</pre>
      </section>

      <section className="lab-guide__section">
        <h2 className="lab-guide__subtitle">线上部署</h2>
        <p>由上层页面在加载 bundle 之前同步注入，注入必须早于 app 启动：</p>
        <pre className="lab-guide__code">{INJECT_SNIPPET}</pre>
      </section>
    </div>
  );
}
