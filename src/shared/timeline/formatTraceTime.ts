/**
 * 时间线的时间格式化。
 *
 * **砍掉小时，只显示分:秒.毫秒**（见 spec「时间线条目形态」）。理由：读者关心的是
 * 相邻调用之间差了几毫秒，小时位在一次演示里恒定不变，只占宽度不给信息。
 *
 * 毫秒必须显示到三位 —— 时间线的核心价值之一就是分辨紧邻调用的先后。
 */

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** `at` 是 `Date.now()` 那样的毫秒时间戳。输出形如 `07:23.045`。 */
export function formatTraceTime(at: number): string {
  const date = new Date(at);
  return `${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`;
}
