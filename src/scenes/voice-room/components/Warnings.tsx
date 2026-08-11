/**
 * 两条必须常驻的告警。
 *
 * 都是 spec 点名「保持现有表述」的文案，改词前先看 spec ——
 * 它们是这个 demo 对外说明自己边界的地方，不是装饰。
 */

import { Headphones, ShieldAlert } from 'lucide-react';

/**
 * 耳机告警。
 *
 * 一个标签页里两个真实客户端**都会真实播放远端音频**，外放必然啸叫。
 */
export function HeadphonesWarning() {
  return (
    <div className="vr-headphones-warning" role="note">
      <Headphones aria-hidden="true" size={20} />
      <div>
        <strong>请佩戴耳机</strong>
        <span>两个真实 RTC 客户端会同时播放远端音频，外放可能产生啸叫。</span>
      </div>
    </div>
  );
}

/**
 * 生产边界告警。
 *
 * **不要改写成「已强制执行的权限控制」。** 踢出、封禁、强制麦控在本 demo 里都是
 * 客户端之间的协作行为：被治理端自己收到命令、自己执行、自己写状态。没有服务端
 * 校验，也就**不构成信任边界** —— 拷走这套代码的人必须知道这件事，所以它常驻页面，
 * 不是折叠的小字。
 */
export function ProductionBoundaryWarning() {
  return (
    <div className="vr-boundary-warning" role="note" data-testid="boundary-warning">
      <ShieldAlert aria-hidden="true" size={20} />
      <div>
        <strong>踢出、封禁、强制麦控都是客户端协作行为，不构成信任边界</strong>
        <span>
          被治理端收到命令后自行执行并写回状态，没有服务端校验。生产环境必须把这些动作
          放到你自己的服务端鉴权之后。
        </span>
      </div>
    </div>
  );
}
